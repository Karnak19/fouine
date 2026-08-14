import { APIError, BetterAuthError } from "../error/index.mjs";
import { logger } from "../env/logger.mjs";
import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { base64 } from "@better-auth/utils/base64";
import { betterFetch } from "@better-fetch/fetch";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
//#region src/social-providers/paypal.ts
/**
* ID token signing algorithms advertised by PayPal's OpenID configuration.
* Anything outside this allowlist is rejected so each token is only ever
* verified with the algorithm it was issued for.
*
* @see https://www.paypal.com/.well-known/openid-configuration
*/
const PAYPAL_ID_TOKEN_ALGORITHMS = ["RS256", "HS256"];
const paypal = (options) => {
	const isSandbox = (options.environment || "sandbox") === "sandbox";
	const authorizationEndpoint = isSandbox ? "https://www.sandbox.paypal.com/signin/authorize" : "https://www.paypal.com/signin/authorize";
	const tokenEndpoint = isSandbox ? "https://api-m.sandbox.paypal.com/v1/oauth2/token" : "https://api-m.paypal.com/v1/oauth2/token";
	const userInfoEndpoint = isSandbox ? "https://api-m.sandbox.paypal.com/v1/identity/oauth2/userinfo" : "https://api-m.paypal.com/v1/identity/oauth2/userinfo";
	/**
	* Issuer and JWKS endpoints used to cryptographically verify ID tokens.
	*
	* @see https://www.paypal.com/.well-known/openid-configuration
	*/
	const issuer = isSandbox ? "https://www.sandbox.paypal.com" : "https://www.paypal.com";
	const jwksEndpoint = isSandbox ? "https://api.sandbox.paypal.com/v1/oauth2/certs" : "https://api.paypal.com/v1/oauth2/certs";
	return {
		id: "paypal",
		name: "PayPal",
		async createAuthorizationURL({ state, codeVerifier, redirectURI }) {
			if (!options.clientId || !options.clientSecret) {
				logger.error("Client Id and Client Secret is required for PayPal. Make sure to provide them in the options.");
				throw new BetterAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
			}
			return await createAuthorizationURL({
				id: "paypal",
				options,
				authorizationEndpoint,
				scopes: [],
				state,
				codeVerifier,
				redirectURI,
				prompt: options.prompt
			});
		},
		validateAuthorizationCode: async ({ code, redirectURI }) => {
			/**
			* PayPal requires Basic Auth for token exchange
			**/
			const credentials = base64.encode(`${options.clientId}:${options.clientSecret}`);
			try {
				const response = await betterFetch(tokenEndpoint, {
					method: "POST",
					headers: {
						Authorization: `Basic ${credentials}`,
						Accept: "application/json",
						"Accept-Language": "en_US",
						"Content-Type": "application/x-www-form-urlencoded"
					},
					body: new URLSearchParams({
						grant_type: "authorization_code",
						code,
						redirect_uri: redirectURI
					}).toString()
				});
				if (!response.data) throw new BetterAuthError("FAILED_TO_GET_ACCESS_TOKEN");
				const data = response.data;
				return {
					accessToken: data.access_token,
					refreshToken: data.refresh_token,
					accessTokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1e3) : void 0,
					idToken: data.id_token
				};
			} catch (error) {
				logger.error("PayPal token exchange failed:", error);
				throw new BetterAuthError("FAILED_TO_GET_ACCESS_TOKEN");
			}
		},
		refreshAccessToken: options.refreshAccessToken ? options.refreshAccessToken : async (refreshToken) => {
			const credentials = base64.encode(`${options.clientId}:${options.clientSecret}`);
			try {
				const response = await betterFetch(tokenEndpoint, {
					method: "POST",
					headers: {
						Authorization: `Basic ${credentials}`,
						Accept: "application/json",
						"Accept-Language": "en_US",
						"Content-Type": "application/x-www-form-urlencoded"
					},
					body: new URLSearchParams({
						grant_type: "refresh_token",
						refresh_token: refreshToken
					}).toString()
				});
				if (!response.data) throw new BetterAuthError("FAILED_TO_REFRESH_ACCESS_TOKEN");
				const data = response.data;
				return {
					accessToken: data.access_token,
					refreshToken: data.refresh_token,
					accessTokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1e3) : void 0
				};
			} catch (error) {
				logger.error("PayPal token refresh failed:", error);
				throw new BetterAuthError("FAILED_TO_REFRESH_ACCESS_TOKEN");
			}
		},
		async verifyIdToken(token, nonce) {
			if (options.disableIdTokenSignIn) return false;
			if (options.verifyIdToken) return options.verifyIdToken(token, nonce);
			try {
				const { kid, alg: jwtAlg } = decodeProtectedHeader(token);
				if (!jwtAlg) return false;
				if (!PAYPAL_ID_TOKEN_ALGORITHMS.includes(jwtAlg)) return false;
				const key = jwtAlg === "HS256" ? new TextEncoder().encode(options.clientSecret) : kid ? await getPayPalPublicKey(kid, jwksEndpoint) : void 0;
				if (!key) return false;
				const { payload: jwtClaims } = await jwtVerify(token, key, {
					algorithms: [jwtAlg],
					issuer,
					audience: options.clientId,
					maxTokenAge: "1h"
				});
				if (nonce && jwtClaims.nonce !== nonce) return false;
				return true;
			} catch (error) {
				logger.error("Failed to verify PayPal ID token:", error);
				return false;
			}
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			if (!token.accessToken) {
				logger.error("Access token is required to fetch PayPal user info");
				return null;
			}
			try {
				const response = await betterFetch(`${userInfoEndpoint}?schema=paypalv1.1`, { headers: {
					Authorization: `Bearer ${token.accessToken}`,
					Accept: "application/json"
				} });
				if (!response.data) {
					logger.error("Failed to fetch user info from PayPal");
					return null;
				}
				const userInfo = response.data;
				if (token.idToken) {
					let idTokenSubject;
					try {
						idTokenSubject = decodeJwt(token.idToken).sub;
					} catch (error) {
						logger.error("Failed to decode PayPal ID token:", error);
						return null;
					}
					const userInfoSubject = userInfo.sub ?? userInfo.user_id;
					if (!idTokenSubject || userInfoSubject !== idTokenSubject) {
						logger.error("PayPal user info subject does not match ID token subject");
						return null;
					}
				}
				const userMap = await options.mapProfileToUser?.(userInfo);
				return {
					user: {
						id: userInfo.user_id,
						name: userInfo.name,
						email: userInfo.email,
						image: userInfo.picture,
						emailVerified: userInfo.email_verified,
						...userMap
					},
					data: userInfo
				};
			} catch (error) {
				logger.error("Failed to fetch user info from PayPal:", error);
				return null;
			}
		},
		options
	};
};
const getPayPalPublicKey = async (kid, jwksUri) => {
	const { data } = await betterFetch(jwksUri);
	if (!data?.keys) throw new APIError("BAD_REQUEST", { message: "Keys not found" });
	const jwk = data.keys.find((key) => key.kid === kid);
	if (!jwk) throw new Error(`JWK with kid ${kid} not found`);
	return await importJWK(jwk, jwk.alg);
};
//#endregion
export { getPayPalPublicKey, paypal };
