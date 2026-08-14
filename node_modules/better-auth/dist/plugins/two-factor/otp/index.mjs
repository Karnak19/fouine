import { parseUserOutput } from "../../../db/schema.mjs";
import { constantTimeEqual } from "../../../crypto/buffer.mjs";
import { generateRandomString } from "../../../crypto/random.mjs";
import { symmetricDecrypt, symmetricEncrypt } from "../../../crypto/index.mjs";
import { setSessionCookie } from "../../../cookies/index.mjs";
import { PACKAGE_VERSION } from "../../../version.mjs";
import { TWO_FACTOR_ERROR_CODES } from "../error-code.mjs";
import { assertTwoFactorNotLocked, recordTwoFactorFailure, resetTwoFactorFailures, verifyTwoFactor } from "../verify-two-factor.mjs";
import { defaultKeyHasher } from "../utils.mjs";
import { APIError, BASE_ERROR_CODES } from "@better-auth/core/error";
import { createAuthEndpoint } from "@better-auth/core/api";
import * as z from "zod";
//#region src/plugins/two-factor/otp/index.ts
const verifyOTPBodySchema = z.object({
	code: z.string().meta({ description: "The otp code to verify. Eg: \"012345\"" }),
	trustDevice: z.boolean().optional().meta({ description: "If true, the device will be trusted for 30 days. It'll be refreshed on every sign in request within this time. Eg: true" })
});
const send2FaOTPBodySchema = z.object({ trustDevice: z.boolean().optional().meta({ description: "If true, the device will be trusted for 30 days. It'll be refreshed on every sign in request within this time. Eg: true" }) }).optional();
/**
* The otp adapter is created from the totp adapter.
*/
const otp2fa = (options) => {
	const opts = {
		storeOTP: "plain",
		digits: 6,
		...options,
		period: (options?.period || 3) * 60 * 1e3
	};
	async function storeOTP(ctx, otp) {
		if (opts.storeOTP === "hashed") return await defaultKeyHasher(otp);
		if (typeof opts.storeOTP === "object" && "hash" in opts.storeOTP) return await opts.storeOTP.hash(otp);
		if (typeof opts.storeOTP === "object" && "encrypt" in opts.storeOTP) return await opts.storeOTP.encrypt(otp);
		if (opts.storeOTP === "encrypted") return await symmetricEncrypt({
			key: ctx.context.secretConfig,
			data: otp
		});
		return otp;
	}
	async function decryptOrHashForComparison(ctx, storedOtp, userInput) {
		if (opts.storeOTP === "hashed") return [storedOtp, await defaultKeyHasher(userInput)];
		if (opts.storeOTP === "encrypted") return [await symmetricDecrypt({
			key: ctx.context.secretConfig,
			data: storedOtp
		}), userInput];
		if (typeof opts.storeOTP === "object" && "encrypt" in opts.storeOTP) return [await opts.storeOTP.decrypt(storedOtp), userInput];
		if (typeof opts.storeOTP === "object" && "hash" in opts.storeOTP) return [storedOtp, await opts.storeOTP.hash(userInput)];
		return [storedOtp, userInput];
	}
	return {
		id: "otp",
		version: PACKAGE_VERSION,
		endpoints: {
			sendTwoFactorOTP: createAuthEndpoint("/two-factor/send-otp", {
				method: "POST",
				body: send2FaOTPBodySchema,
				metadata: { openapi: {
					summary: "Send two factor OTP",
					description: "Send two factor OTP to the user",
					responses: { 200: {
						description: "Successful response",
						content: { "application/json": { schema: {
							type: "object",
							properties: { status: { type: "boolean" } }
						} } }
					} }
				} }
			}, async (ctx) => {
				if (!options || !options.sendOTP) {
					ctx.context.logger.error("send otp isn't configured. Please configure the send otp function on otp options.");
					throw APIError.from("BAD_REQUEST", {
						message: "otp isn't configured",
						code: "OTP_NOT_CONFIGURED"
					});
				}
				const { session, key } = await verifyTwoFactor(ctx);
				const code = generateRandomString(opts.digits, "0-9");
				const hashedCode = await storeOTP(ctx, code);
				await ctx.context.internalAdapter.createVerificationValue({
					value: `${hashedCode}:0`,
					identifier: `2fa-otp-${key}`,
					expiresAt: new Date(Date.now() + opts.period)
				});
				const sendOTPResult = options.sendOTP({
					user: session.user,
					otp: code
				}, ctx);
				if (sendOTPResult instanceof Promise) await ctx.context.runInBackgroundOrAwait(sendOTPResult.catch((e) => {
					ctx.context.logger.error("Failed to send two-factor OTP", e);
				}));
				return ctx.json({ status: true });
			}),
			verifyTwoFactorOTP: createAuthEndpoint("/two-factor/verify-otp", {
				method: "POST",
				body: verifyOTPBodySchema,
				metadata: { openapi: {
					summary: "Verify two factor OTP",
					description: "Verify two factor OTP",
					responses: { "200": {
						description: "Two-factor OTP verified successfully",
						content: { "application/json": { schema: {
							type: "object",
							properties: {
								token: {
									type: "string",
									description: "Session token for the authenticated session"
								},
								user: {
									type: "object",
									properties: {
										id: {
											type: "string",
											description: "Unique identifier of the user"
										},
										email: {
											type: "string",
											format: "email",
											nullable: true,
											description: "User's email address"
										},
										emailVerified: {
											type: "boolean",
											nullable: true,
											description: "Whether the email is verified"
										},
										name: {
											type: "string",
											nullable: true,
											description: "User's name"
										},
										image: {
											type: "string",
											format: "uri",
											nullable: true,
											description: "User's profile image URL"
										},
										createdAt: {
											type: "string",
											format: "date-time",
											description: "Timestamp when the user was created"
										},
										updatedAt: {
											type: "string",
											format: "date-time",
											description: "Timestamp when the user was last updated"
										}
									},
									required: [
										"id",
										"createdAt",
										"updatedAt"
									],
									description: "The authenticated user object"
								}
							},
							required: ["token", "user"]
						} } }
					} }
				} }
			}, async (ctx) => {
				const { session, key, valid, invalid } = await verifyTwoFactor(ctx);
				const isSignIn = !session.session;
				const twoFactorTable = "twoFactor";
				let twoFactor = null;
				if (isSignIn) {
					twoFactor = await ctx.context.adapter.findOne({
						model: twoFactorTable,
						where: [{
							field: "userId",
							value: session.user.id
						}]
					});
					if (!twoFactor) throw APIError.from("BAD_REQUEST", TWO_FACTOR_ERROR_CODES.TWO_FACTOR_NOT_ENABLED);
					await assertTwoFactorNotLocked(ctx, twoFactorTable, twoFactor);
				}
				const consumed = await ctx.context.internalAdapter.consumeVerificationValue(`2fa-otp-${key}`);
				if (!consumed) throw APIError.from("BAD_REQUEST", TWO_FACTOR_ERROR_CODES.OTP_HAS_EXPIRED);
				const [otp, counter] = consumed.value?.split(":") ?? [];
				const allowedAttempts = options?.allowedAttempts || 5;
				const attempts = parseInt(counter, 10) || 0;
				if (attempts >= allowedAttempts) throw APIError.from("BAD_REQUEST", TWO_FACTOR_ERROR_CODES.TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE);
				const [storedValue, inputValue] = await decryptOrHashForComparison(ctx, otp, ctx.body.code);
				if (constantTimeEqual(new TextEncoder().encode(storedValue), new TextEncoder().encode(inputValue))) {
					if (twoFactor) await resetTwoFactorFailures(ctx, twoFactorTable, twoFactor);
					if (!session.user.twoFactorEnabled) {
						if (!session.session) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.FAILED_TO_CREATE_SESSION);
						const updatedUser = await ctx.context.internalAdapter.updateUser(session.user.id, { twoFactorEnabled: true });
						const newSession = await ctx.context.internalAdapter.createSession(session.user.id, false, session.session);
						await setSessionCookie(ctx, {
							session: newSession,
							user: updatedUser
						});
						await ctx.context.internalAdapter.deleteSession(session.session.token);
						return ctx.json({
							token: newSession.token,
							user: parseUserOutput(ctx.context.options, updatedUser)
						});
					}
					return valid(ctx);
				}
				await ctx.context.internalAdapter.createVerificationValue({
					value: `${otp}:${attempts + 1}`,
					identifier: `2fa-otp-${key}`,
					expiresAt: consumed.expiresAt
				});
				if (twoFactor) await recordTwoFactorFailure(ctx, twoFactorTable, twoFactor);
				return invalid("INVALID_CODE");
			})
		}
	};
};
//#endregion
export { otp2fa };
