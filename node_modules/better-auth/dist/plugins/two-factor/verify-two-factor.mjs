import { parseUserOutput } from "../../db/schema.mjs";
import { generateRandomString } from "../../crypto/random.mjs";
import { expireCookie, setSessionCookie } from "../../cookies/index.mjs";
import { getSessionFromCtx } from "../../api/routes/session.mjs";
import { TWO_FACTOR_ERROR_CODES } from "./error-code.mjs";
import { TRUST_DEVICE_COOKIE_NAME, TWO_FACTOR_COOKIE_NAME } from "./constant.mjs";
import { APIError } from "@better-auth/core/error";
import { createHMAC } from "@better-auth/utils/hmac";
//#region src/plugins/two-factor/verify-two-factor.ts
async function verifyTwoFactor(ctx) {
	const invalid = (errorKey) => {
		throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES[errorKey]);
	};
	const session = await getSessionFromCtx(ctx);
	if (!session) {
		const twoFactorCookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
		const signedTwoFactorCookie = await ctx.getSignedCookie(twoFactorCookie.name, ctx.context.secret);
		if (!signedTwoFactorCookie) throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE);
		const verificationToken = await ctx.context.internalAdapter.findVerificationValue(signedTwoFactorCookie);
		if (!verificationToken) throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE);
		const user = await ctx.context.internalAdapter.findUserById(verificationToken.value);
		if (!user) throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE);
		const dontRememberMe = await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret);
		return {
			valid: async (ctx) => {
				const consumed = await ctx.context.internalAdapter.consumeVerificationValue(signedTwoFactorCookie);
				if (!consumed || consumed.value !== user.id) {
					expireCookie(ctx, twoFactorCookie);
					throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE);
				}
				const session = await ctx.context.internalAdapter.createSession(consumed.value, !!dontRememberMe);
				if (!session) throw APIError.from("INTERNAL_SERVER_ERROR", {
					message: "failed to create session",
					code: "FAILED_TO_CREATE_SESSION"
				});
				await setSessionCookie(ctx, {
					session,
					user
				});
				expireCookie(ctx, twoFactorCookie);
				if (ctx.body.trustDevice) {
					const maxAge = ctx.context.getPlugin("two-factor").options?.trustDeviceMaxAge ?? 2592e3;
					const trustDeviceCookie = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME, { maxAge });
					/**
					* Create a random identifier for the trust device record.
					* Store it in the verification table with an expiration
					* so the server can validate and revoke it.
					*/
					const trustIdentifier = `trust-device-${generateRandomString(32)}`;
					const token = await createHMAC("SHA-256", "base64urlnopad").sign(ctx.context.secret, `${user.id}!${trustIdentifier}`);
					await ctx.context.internalAdapter.createVerificationValue({
						value: user.id,
						identifier: trustIdentifier,
						expiresAt: new Date(Date.now() + maxAge * 1e3)
					});
					await ctx.setSignedCookie(trustDeviceCookie.name, `${token}!${trustIdentifier}`, ctx.context.secret, trustDeviceCookie.attributes);
					expireCookie(ctx, ctx.context.authCookies.dontRememberToken);
				}
				return ctx.json({
					token: session.token,
					user: parseUserOutput(ctx.context.options, user)
				});
			},
			invalid,
			session: {
				session: null,
				user
			},
			key: signedTwoFactorCookie,
			beginAttempt: async (allowedAttempts) => {
				const identifier = `2fa-attempts-${signedTwoFactorCookie}`;
				const consumed = await ctx.context.internalAdapter.consumeVerificationValue(identifier).catch(() => null);
				if (!consumed) throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE);
				const parsed = Number(consumed.value);
				const attempts = Number.isInteger(parsed) && parsed >= 0 ? parsed : allowedAttempts;
				if (attempts >= allowedAttempts) {
					await ctx.context.internalAdapter.consumeVerificationValue(signedTwoFactorCookie).catch(() => {});
					expireCookie(ctx, twoFactorCookie);
					throw APIError.from("BAD_REQUEST", TWO_FACTOR_ERROR_CODES.TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE);
				}
				const rearm = (count) => ctx.context.internalAdapter.createVerificationValue({
					value: `${count}`,
					identifier,
					expiresAt: verificationToken.expiresAt
				}).catch(() => {});
				return {
					recordFailure: () => rearm(attempts + 1),
					restore: () => rearm(attempts)
				};
			}
		};
	}
	return {
		valid: async (ctx) => {
			return ctx.json({
				token: session.session.token,
				user: parseUserOutput(ctx.context.options, session.user)
			});
		},
		invalid,
		session,
		key: `${session.user.id}!${session.session.id}`,
		beginAttempt: async (_allowedAttempts) => ({
			recordFailure: async () => {},
			restore: async () => {}
		})
	};
}
function resolveAccountLockoutConfig(ctx) {
	const lockout = (ctx.context.getPlugin("two-factor")?.options)?.accountLockout;
	return {
		enabled: lockout?.enabled ?? true,
		maxFailedAttempts: lockout?.maxFailedAttempts ?? 10,
		durationMs: (lockout?.durationSeconds ?? 900) * 1e3
	};
}
/**
* Reject the verification when the account is locked, and lazily clear an
* expired lock. The lock caps consecutive failed verifications per account,
* across challenges and factors (NIST SP 800-63B §5.2.2).
*/
async function assertTwoFactorNotLocked(ctx, twoFactorTable, twoFactor) {
	const { enabled } = resolveAccountLockoutConfig(ctx);
	if (!enabled || !twoFactor.lockedUntil) return;
	if (new Date(twoFactor.lockedUntil).getTime() > Date.now()) throw APIError.from("TOO_MANY_REQUESTS", TWO_FACTOR_ERROR_CODES.ACCOUNT_TEMPORARILY_LOCKED);
	await ctx.context.adapter.incrementOne({
		model: twoFactorTable,
		where: [{
			field: "id",
			value: twoFactor.id
		}, {
			field: "lockedUntil",
			operator: "lte",
			value: /* @__PURE__ */ new Date()
		}],
		increment: {},
		set: {
			failedVerificationCount: 0,
			lockedUntil: null
		}
	});
}
/**
* Count one failed verification toward the account-level budget, and lock the
* account once the budget is spent. The increment is atomic, so concurrent
* failures cannot lose updates. It is unguarded so it still applies to a row
* whose counter is null or absent (a row created before the migration, or a
* document-store record predating the column), where a guarded comparison
* would never match.
*/
async function recordTwoFactorFailure(ctx, twoFactorTable, twoFactor) {
	const { enabled, maxFailedAttempts, durationMs } = resolveAccountLockoutConfig(ctx);
	if (!enabled) return;
	if (((await ctx.context.adapter.incrementOne({
		model: twoFactorTable,
		where: [{
			field: "id",
			value: twoFactor.id
		}],
		increment: { failedVerificationCount: 1 }
	}))?.failedVerificationCount ?? 0) >= maxFailedAttempts) await ctx.context.adapter.update({
		model: twoFactorTable,
		where: [{
			field: "id",
			value: twoFactor.id
		}],
		update: { lockedUntil: new Date(Date.now() + durationMs) }
	});
}
/**
* Clear the account-level failure budget after a successful verification, so the
* count tracks only consecutive failures. The write is unconditional: a snapshot
* read at the start of the request can miss a concurrent failure, so skipping it
* could leave the counter non-zero after a success.
*/
async function resetTwoFactorFailures(ctx, twoFactorTable, twoFactor) {
	const { enabled } = resolveAccountLockoutConfig(ctx);
	if (!enabled) return;
	await ctx.context.adapter.update({
		model: twoFactorTable,
		where: [{
			field: "id",
			value: twoFactor.id
		}],
		update: {
			failedVerificationCount: 0,
			lockedUntil: null
		}
	});
}
//#endregion
export { assertTwoFactorNotLocked, recordTwoFactorFailure, resetTwoFactorFailures, verifyTwoFactor };
