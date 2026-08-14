import { BetterAuthError } from "../error/index.mjs";
import { logger } from "../env/logger.mjs";
import { getPrimaryClientId } from "../oauth2/utils.mjs";
import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
//#region src/social-providers/facebook.ts
/**
* Validate an opaque Facebook access token against the configured app.
*
* Facebook access tokens are not audience-bound at the Graph `/me` endpoint: a
* token minted for any Facebook app returns that app's profile. Without this
* check, a token issued to an unrelated app could be presented to this
* app's direct sign-in path and accepted as proof of identity. We call the
* `debug_token` endpoint and require the token to be valid, bound to one of the
* configured client ids, and tied to a user.
*
* @see https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging
*
* @returns the inspected token's `user_id` when the token is valid and bound to
* the configured app, otherwise `null`.
*/
async function verifyFacebookAccessToken(accessToken, options) {
	const primaryClientId = getPrimaryClientId(options.clientId);
	if (!primaryClientId || !options.clientSecret) return null;
	const clientIds = Array.isArray(options.clientId) ? options.clientId : [options.clientId];
	const { data, error } = await betterFetch("https://graph.facebook.com/debug_token", { query: {
		input_token: accessToken,
		access_token: `${primaryClientId}|${options.clientSecret}`
	} });
	if (error || !data?.data) return null;
	const { is_valid, app_id, user_id } = data.data;
	if (is_valid !== true || !app_id || !clientIds.includes(app_id) || !user_id) return null;
	return user_id;
}
const facebook = (options) => {
	return {
		id: "facebook",
		name: "Facebook",
		async createAuthorizationURL({ state, scopes, redirectURI, loginHint }) {
			if (!getPrimaryClientId(options.clientId) || !options.clientSecret) {
				logger.error("Client ID and client secret are required for Facebook. Make sure to provide them in the options.");
				throw new BetterAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
			}
			const _scopes = options.disableDefaultScope ? [] : ["email", "public_profile"];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return await createAuthorizationURL({
				id: "facebook",
				options,
				authorizationEndpoint: "https://www.facebook.com/v24.0/dialog/oauth",
				scopes: _scopes,
				state,
				redirectURI,
				loginHint,
				additionalParams: options.configId ? { config_id: options.configId } : {}
			});
		},
		validateAuthorizationCode: async ({ code, redirectURI }) => {
			return validateAuthorizationCode({
				code,
				redirectURI,
				options,
				tokenEndpoint: "https://graph.facebook.com/v24.0/oauth/access_token"
			});
		},
		async verifyIdToken(token, nonce) {
			if (options.disableIdTokenSignIn) return false;
			if (options.verifyIdToken) return options.verifyIdToken(token, nonce);
			if (token.split(".").length === 3) try {
				const { payload: jwtClaims } = await jwtVerify(token, createRemoteJWKSet(new URL("https://limited.facebook.com/.well-known/oauth/openid/jwks/")), {
					algorithms: ["RS256"],
					audience: options.clientId,
					issuer: "https://www.facebook.com"
				});
				if (nonce && jwtClaims.nonce !== nonce) return false;
				return !!jwtClaims;
			} catch {
				return false;
			}
			return await verifyFacebookAccessToken(token, options) !== null;
		},
		refreshAccessToken: options.refreshAccessToken ? options.refreshAccessToken : async (refreshToken) => {
			return refreshAccessToken({
				refreshToken,
				options: {
					clientId: options.clientId,
					clientKey: options.clientKey,
					clientSecret: options.clientSecret
				},
				tokenEndpoint: "https://graph.facebook.com/v24.0/oauth/access_token"
			});
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			if (token.idToken && token.idToken.split(".").length === 3) {
				const profile = decodeJwt(token.idToken);
				const user = {
					id: profile.sub,
					name: profile.name,
					email: profile.email,
					picture: { data: {
						url: profile.picture,
						height: 100,
						width: 100,
						is_silhouette: false
					} }
				};
				const userMap = await options.mapProfileToUser?.({
					...user,
					email_verified: false
				});
				return {
					user: {
						...user,
						emailVerified: false,
						...userMap
					},
					data: profile
				};
			}
			const accessToken = token.accessToken;
			if (!accessToken) return null;
			const tokenUserId = await verifyFacebookAccessToken(accessToken, options);
			if (!tokenUserId) return null;
			const { data: profile, error } = await betterFetch("https://graph.facebook.com/me?fields=" + [
				"id",
				"name",
				"email",
				"picture",
				...options?.fields || []
			].join(","), { auth: {
				type: "Bearer",
				token: accessToken
			} });
			if (error) return null;
			if (profile.id !== tokenUserId) return null;
			const userMap = await options.mapProfileToUser?.(profile);
			return {
				user: {
					id: profile.id,
					name: profile.name,
					email: profile.email,
					image: profile.picture.data.url,
					emailVerified: profile.email_verified ?? false,
					...userMap
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { facebook };
