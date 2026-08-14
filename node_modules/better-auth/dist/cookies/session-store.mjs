import { symmetricDecodeJWT, symmetricEncodeJWT } from "../crypto/jwt.mjs";
import { parseCookies } from "./cookie-utils.mjs";
import { safeJSONParse } from "@better-auth/core/utils/json";
import { serializeCookie } from "better-call";
import * as z from "zod";
//#region src/cookies/session-store.ts
/**
* Per-cookie byte ceiling.
* Safari's ~4093 floor is the lowest among browsers.
* Kept a little under it for attributes added after sizing.
*
* @see https://datatracker.ietf.org/doc/html/rfc6265#section-6.1
* @see https://github.com/dotnet/aspnetcore/blob/aa5493528640932601bb82ef3295e4d8ca7e11c5/src/Shared/ChunkingCookieManager/ChunkingCookieManager.cs#L40
*/
const MAX_COOKIE_SIZE = 4050;
/**
* Max chunks per cookie.
* A larger value does not belong in a cookie.
*/
const MAX_COOKIE_CHUNKS = 100;
/**
* Largest value that keeps the serialized cookie within {@link MAX_COOKIE_SIZE},
* measured with the real `serializeCookie` writer so it stays in sync with the
* wire. Non-positive when the name and attributes alone overflow.
*/
function getMaxCookieValueSize(name, options) {
	return MAX_COOKIE_SIZE - serializeCookie(name, "", { ...options }).length;
}
/**
* Read all existing chunks from cookies
*/
function readExistingChunks(cookieName, ctx) {
	const chunks = {};
	const cookies = parseCookies(ctx.headers?.get("cookie") || "");
	for (const [name, value] of cookies) if (name.startsWith(cookieName)) chunks[name] = value;
	return chunks;
}
/**
* Split a cookie value into chunks if needed
*/
function chunkCookie(storeName, cookie, chunks, logger) {
	const chunkSize = getMaxCookieValueSize(`${cookie.name}.${MAX_COOKIE_CHUNKS - 1}`, cookie.attributes);
	const chunkCount = chunkSize > 0 ? Math.ceil(cookie.value.length / chunkSize) : Infinity;
	if (chunkCount <= 1) {
		chunks[cookie.name] = cookie.value;
		return [cookie];
	}
	if (chunkCount > MAX_COOKIE_CHUNKS) {
		logger.warn(`${storeName} cookie is too large to store even after chunking, so the cache was skipped. Reduce the cached data or use a database session.`);
		return [];
	}
	const cookies = [];
	for (let i = 0; i < chunkCount; i++) {
		const name = `${cookie.name}.${i}`;
		const start = i * chunkSize;
		const value = cookie.value.substring(start, start + chunkSize);
		cookies.push({
			...cookie,
			name,
			value
		});
		chunks[name] = value;
	}
	logger.debug(`CHUNKING_${storeName.toUpperCase()}_COOKIE`, {
		message: `${storeName} cookie exceeds the ${MAX_COOKIE_SIZE} byte limit and was split into ${chunkCount} chunks.`,
		valueSize: cookie.value.length,
		chunkCount,
		chunkSizes: cookies.map((c) => c.value.length)
	});
	return cookies;
}
/**
* Get all cookies that should be cleaned (removed)
*/
function getCleanCookies(chunks, cookieOptions) {
	const cleanedChunks = {};
	for (const name in chunks) cleanedChunks[name] = {
		name,
		value: "",
		attributes: {
			...cookieOptions,
			maxAge: 0
		}
	};
	return cleanedChunks;
}
/**
* Store that splits a cookie into numbered chunks when its serialized form
* would exceed the per-cookie byte limit, expiring stale chunks as needed.
*
* @see https://github.com/nextauthjs/next-auth/blob/27b2519b84b8eb9cf053775dea29d577d2aa0098/packages/next-auth/src/core/lib/cookie.ts
*/
const storeFactory = (storeName) => (cookieName, cookieOptions, ctx) => {
	const chunks = readExistingChunks(cookieName, ctx);
	const logger = ctx.context.logger;
	const expireExistingChunks = () => {
		const expired = getCleanCookies(chunks, cookieOptions);
		for (const name in chunks) delete chunks[name];
		return expired;
	};
	return {
		chunk(value, options) {
			const cookies = expireExistingChunks();
			const chunked = chunkCookie(storeName, {
				name: cookieName,
				value,
				attributes: {
					...cookieOptions,
					...options
				}
			}, chunks, logger);
			for (const chunk of chunked) cookies[chunk.name] = chunk;
			return Object.values(cookies);
		},
		clean() {
			return Object.values(expireExistingChunks());
		},
		setCookies(cookies) {
			for (const cookie of cookies) ctx.setCookie(cookie.name, cookie.value, cookie.attributes);
		}
	};
};
const createSessionStore = storeFactory("Session");
const createAccountStore = storeFactory("Account");
function getChunkedCookie(ctx, cookieName) {
	const value = ctx.getCookie(cookieName);
	if (value) return value;
	const chunks = [];
	const cookieHeader = ctx.headers?.get("cookie");
	if (!cookieHeader) return null;
	for (const [name, val] of parseCookies(cookieHeader)) if (name.startsWith(cookieName + ".")) {
		const indexStr = name.split(".").at(-1);
		const index = parseInt(indexStr || "0", 10);
		if (!isNaN(index)) chunks.push({
			index,
			value: val
		});
	}
	if (chunks.length > 0) {
		chunks.sort((a, b) => a.index - b.index);
		return chunks.map((c) => c.value).join("");
	}
	return null;
}
async function setAccountCookie(c, accountData) {
	const accountDataCookie = c.context.authCookies.accountData;
	const options = {
		maxAge: 300,
		...accountDataCookie.attributes
	};
	const data = await symmetricEncodeJWT(accountData, c.context.secretConfig, "better-auth-account", options.maxAge);
	const accountStore = createAccountStore(accountDataCookie.name, options, c);
	accountStore.setCookies(accountStore.chunk(data, options));
}
async function getAccountCookie(c) {
	const accountCookie = getChunkedCookie(c, c.context.authCookies.accountData.name);
	if (accountCookie) {
		const accountData = safeJSONParse(await symmetricDecodeJWT(accountCookie, c.context.secretConfig, "better-auth-account"));
		if (accountData) return accountData;
	}
	return null;
}
const getSessionQuerySchema = z.optional(z.object({
	disableCookieCache: z.coerce.boolean().meta({ description: "Disable cookie cache and fetch session from database" }).optional(),
	disableRefresh: z.coerce.boolean().meta({ description: "Disable session refresh. Useful for checking session status, without updating the session" }).optional()
}));
//#endregion
export { createAccountStore, createSessionStore, getAccountCookie, getChunkedCookie, getSessionQuerySchema, setAccountCookie };
