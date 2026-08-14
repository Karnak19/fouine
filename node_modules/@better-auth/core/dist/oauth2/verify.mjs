import { logger } from "../env/logger.mjs";
import { fetchRefusingRedirects } from "./reject-redirects.mjs";
import { APIError } from "better-call";
import { UnsecuredJWT, createLocalJWKSet, decodeProtectedHeader, errors, jwtVerify } from "jose";
//#region src/oauth2/verify.ts
const joseInfrastructureErrorCodes = new Set([
	errors.JWKSTimeout.code,
	errors.JWKSInvalid.code,
	errors.JWKSMultipleMatchingKeys.code
]);
function isJoseInfrastructureError(error) {
	return joseInfrastructureErrorCodes.has(error.code);
}
/**
* @internal
*/
const jwksCache = /* @__PURE__ */ new Map();
/**
* Cache for function jwks sources, keyed by a caller-provided stable object.
* Entries are released with their key, so per-request keys cannot accumulate.
*/
const functionJwksCache = /* @__PURE__ */ new WeakMap();
/**
* How long a cached JWKS is trusted before it is refetched
*
* @internal
*/
const JWKS_CACHE_TTL_MS = 300 * 1e3;
const JWKS_NO_KID_REFETCH_COOLDOWN_MS = 30 * 1e3;
/**
* Returns the cached key set when it is within the TTL. When the token carries
* `kid`, the cached set must contain that key id; without `kid`, key selection
* is deferred to JOSE because RFC 7515 makes the header parameter optional.
*/
function getFreshJwksWithKid(cached, kid) {
	if (!cached) return void 0;
	if (Date.now() - cached.fetchedAt >= JWKS_CACHE_TTL_MS) return void 0;
	if (kid && !cached.jwks.keys.some((jwk) => jwk.kid === kid)) return;
	return cached.jwks;
}
function shouldRefetchCachedJwksWithoutKid(error, resolved) {
	if (!(resolved.fromCache && !resolved.kid && (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWSSignatureVerificationFailed))) return false;
	if (!resolved.noKidRefetchedAt) return true;
	return Date.now() - resolved.noKidRefetchedAt >= JWKS_NO_KID_REFETCH_COOLDOWN_MS;
}
async function fetchJwks(jwksFetch) {
	const jwks = typeof jwksFetch === "string" ? await fetchRefusingRedirects(jwksFetch, { headers: { Accept: "application/json" } }).then(async (res) => {
		if (res.error) throw new Error(`Jwks failed: ${res.error.message ?? res.error.statusText}`);
		return res.data;
	}) : await jwksFetch();
	if (!jwks) throw new Error("No jwks found");
	return jwks;
}
/**
* Performs local verification of an access token for your APIs.
*
* Can also be configured for remote verification.
*/
async function verifyJwsAccessToken(token, opts) {
	try {
		const resolved = await getJwksForVerification(token, opts);
		let jwt;
		try {
			jwt = await jwtVerify(token, createLocalJWKSet(resolved.jwks), opts.verifyOptions);
		} catch (error) {
			if (shouldRefetchCachedJwksWithoutKid(error, resolved)) jwt = await jwtVerify(token, createLocalJWKSet((await getJwksForVerification(token, {
				...opts,
				forceRefresh: true
			})).jwks), opts.verifyOptions);
			else throw error;
		}
		if (jwt.payload.azp) jwt.payload.client_id = jwt.payload.azp;
		return jwt.payload;
	} catch (error) {
		if (error instanceof Error) throw error;
		throw new Error(error);
	}
}
async function getJwks(token, opts) {
	return (await getJwksForVerification(token, opts)).jwks;
}
async function getJwksForVerification(token, opts) {
	let jwtHeaders;
	try {
		jwtHeaders = decodeProtectedHeader(token);
	} catch (error) {
		if (error instanceof Error) throw error;
		throw new Error(error);
	}
	const kid = jwtHeaders.kid;
	if (typeof opts.jwksFetch !== "string") {
		const cacheKey = opts.jwksCacheKey;
		if (!cacheKey) {
			const jwks = await opts.jwksFetch();
			if (!jwks) throw new Error("No jwks found");
			return {
				jwks,
				fromCache: false,
				kid
			};
		}
		const cached = functionJwksCache.get(cacheKey);
		const cachedJwks = opts.forceRefresh ? void 0 : getFreshJwksWithKid(cached, kid);
		if (cachedJwks) return {
			jwks: cachedJwks,
			fromCache: true,
			kid,
			noKidRefetchedAt: cached?.noKidRefetchedAt
		};
		const jwks = await opts.jwksFetch();
		if (!jwks) throw new Error("No jwks found");
		const fetchedAt = Date.now();
		functionJwksCache.set(cacheKey, {
			jwks,
			fetchedAt,
			...opts.forceRefresh && !kid ? { noKidRefetchedAt: fetchedAt } : {}
		});
		return {
			jwks,
			fromCache: false,
			kid
		};
	}
	const cacheKey = opts.jwksFetch;
	const cached = jwksCache.get(cacheKey);
	const cachedJwks = opts.forceRefresh ? void 0 : getFreshJwksWithKid(cached, kid);
	if (!cachedJwks) {
		const jwks = await fetchJwks(opts.jwksFetch);
		const fetchedAt = Date.now();
		jwksCache.set(cacheKey, {
			jwks,
			fetchedAt,
			...opts.forceRefresh && !kid ? { noKidRefetchedAt: fetchedAt } : {}
		});
		return {
			jwks,
			fromCache: false,
			kid
		};
	}
	return {
		jwks: cachedJwks,
		fromCache: true,
		kid,
		noKidRefetchedAt: cached?.noKidRefetchedAt
	};
}
/**
* Performs local verification of an access token for your API.
*
* Can also be configured for remote verification.
*/
async function verifyAccessToken(token, opts) {
	let payload;
	if (opts.jwksUrl && !opts?.remoteVerify?.force) try {
		payload = await verifyJwsAccessToken(token, {
			jwksFetch: opts.jwksUrl,
			verifyOptions: opts.verifyOptions
		});
	} catch (error) {
		if (error instanceof Error) if (error.name === "TypeError" || error.name === "JWSInvalid") {} else if (error instanceof errors.JWTExpired) throw new APIError("UNAUTHORIZED", { message: "token expired" });
		else if (error instanceof errors.JOSEError) {
			if (isJoseInfrastructureError(error)) throw error;
			throw new APIError("UNAUTHORIZED", { message: "invalid access token" });
		} else throw error;
		else throw new Error(error);
	}
	if (opts?.remoteVerify) {
		const { data: introspect, error: introspectError } = await fetchRefusingRedirects(opts.remoteVerify.introspectUrl, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded"
			},
			body: new URLSearchParams({
				client_id: opts.remoteVerify.clientId,
				client_secret: opts.remoteVerify.clientSecret,
				token,
				token_type_hint: "access_token"
			}).toString()
		});
		if (introspectError) logger.error(`Introspection failed: ${introspectError.message ?? introspectError.statusText}`);
		if (!introspect) throw new APIError("INTERNAL_SERVER_ERROR", { message: "introspection failed" });
		if (!introspect.active) throw new APIError("UNAUTHORIZED", { message: "token inactive" });
		try {
			const unsecuredJwt = new UnsecuredJWT(introspect).encode();
			const { audience: _audience, ...verifyOptionsNoAudience } = opts.verifyOptions;
			const skipAudience = !introspect.aud && opts.remoteVerify.allowMissingAudience === true;
			payload = UnsecuredJWT.decode(unsecuredJwt, skipAudience ? verifyOptionsNoAudience : opts.verifyOptions).payload;
		} catch (error) {
			throw new Error(error);
		}
	}
	if (!payload) throw new APIError("UNAUTHORIZED", { message: `no token payload` });
	if (opts.scopes) {
		const validScopes = new Set(payload.scope?.split(" "));
		for (const sc of opts.scopes) if (!validScopes.has(sc)) throw new APIError("FORBIDDEN", { message: `invalid scope ${sc}` });
	}
	return payload;
}
//#endregion
export { getJwks, verifyAccessToken, verifyJwsAccessToken };
