import { APIError, BetterAuthError } from "../error/index.mjs";
import { logger } from "../env/logger.mjs";
import { getPrimaryClientId } from "../oauth2/utils.mjs";
import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
//#region src/social-providers/google.ts
const GOOGLE_ID_TOKEN_MAX_AGE = "1h";
/**
* Verifies a Google ID token against Google's issuer, audience, signature,
* expiry, and maximum token age.
*/
const verifyGoogleIdToken = async ({ token, audience, nonce }) => {
	try {
		const { kid, alg: jwtAlg } = decodeProtectedHeader(token);
		if (!kid || !jwtAlg) return null;
		const { payload: jwtClaims } = await jwtVerify(token, await getGooglePublicKey(kid), {
			algorithms: [jwtAlg],
			issuer: ["https://accounts.google.com", "accounts.google.com"],
			audience,
			maxTokenAge: GOOGLE_ID_TOKEN_MAX_AGE
		});
		if (nonce && jwtClaims.nonce !== nonce) return null;
		return jwtClaims;
	} catch {
		return null;
	}
};
/**
* Checks whether Google's verified `hd` claim satisfies the configured hosted
* domain restriction. `hd: "*"` accepts any Google Workspace hosted domain.
*/
const isGoogleHostedDomainAllowed = (configuredHostedDomain, tokenHostedDomain) => {
	if (!configuredHostedDomain) return true;
	if (typeof tokenHostedDomain !== "string" || !tokenHostedDomain) return false;
	if (configuredHostedDomain === "*") return true;
	return tokenHostedDomain === configuredHostedDomain;
};
const google = (options) => {
	return {
		id: "google",
		name: "Google",
		async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, loginHint, display }) {
			if (!getPrimaryClientId(options.clientId) || !options.clientSecret) {
				logger.error("Client Id and Client Secret is required for Google. Make sure to provide them in the options.");
				throw new BetterAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
			}
			if (!codeVerifier) throw new BetterAuthError("codeVerifier is required for Google");
			const _scopes = options.disableDefaultScope ? [] : [
				"email",
				"profile",
				"openid"
			];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return await createAuthorizationURL({
				id: "google",
				options,
				authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
				scopes: _scopes,
				state,
				codeVerifier,
				redirectURI,
				prompt: options.prompt,
				accessType: options.accessType,
				display: display || options.display,
				loginHint,
				hd: options.hd,
				additionalParams: { include_granted_scopes: "true" }
			});
		},
		validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) => {
			return validateAuthorizationCode({
				code,
				codeVerifier,
				redirectURI,
				options,
				tokenEndpoint: "https://oauth2.googleapis.com/token"
			});
		},
		refreshAccessToken: options.refreshAccessToken ? options.refreshAccessToken : async (refreshToken) => {
			return refreshAccessToken({
				refreshToken,
				options: {
					clientId: options.clientId,
					clientKey: options.clientKey,
					clientSecret: options.clientSecret
				},
				tokenEndpoint: "https://oauth2.googleapis.com/token"
			});
		},
		async verifyIdToken(token, nonce) {
			if (options.disableIdTokenSignIn) return false;
			if (options.verifyIdToken) return options.verifyIdToken(token, nonce);
			const jwtClaims = await verifyGoogleIdToken({
				token,
				audience: options.clientId,
				nonce
			});
			if (!jwtClaims) return false;
			return isGoogleHostedDomainAllowed(options.hd, jwtClaims.hd);
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			if (!token.idToken) return null;
			const user = decodeJwt(token.idToken);
			if (!isGoogleHostedDomainAllowed(options.hd, user.hd)) {
				logger.error(`Google sign-in rejected: id token hosted domain (hd) "${user.hd ?? "<missing>"}" does not satisfy the configured "hd" option "${options.hd}".`);
				return null;
			}
			const userMap = await options.mapProfileToUser?.(user);
			return {
				user: {
					id: user.sub,
					name: user.name,
					email: user.email,
					image: user.picture,
					emailVerified: user.email_verified,
					...userMap
				},
				data: user
			};
		},
		options
	};
};
const getGooglePublicKey = async (kid) => {
	const { data } = await betterFetch("https://www.googleapis.com/oauth2/v3/certs");
	if (!data?.keys) throw new APIError("BAD_REQUEST", { message: "Keys not found" });
	const jwk = data.keys.find((key) => key.kid === kid);
	if (!jwk) throw new Error(`JWK with kid ${kid} not found`);
	return await importJWK(jwk, jwk.alg);
};
//#endregion
export { getGooglePublicKey, google, isGoogleHostedDomainAllowed, verifyGoogleIdToken };
