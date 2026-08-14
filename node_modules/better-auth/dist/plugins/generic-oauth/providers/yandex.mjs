import { betterFetch } from "@better-fetch/fetch";
//#region src/plugins/generic-oauth/providers/yandex.ts
/**
* Yandex OAuth provider helper
*
* @example
* ```ts
* import { genericOAuth, yandex } from "better-auth/plugins/generic-oauth";
*
* export const auth = betterAuth({
*   plugins: [
*     genericOAuth({
*       config: [
*         yandex({
*           clientId: process.env.YANDEX_CLIENT_ID,
*           clientSecret: process.env.YANDEX_CLIENT_SECRET,
*         }),
*       ],
*     }),
*   ],
* });
* ```
*/
function yandex(options) {
	const defaultScopes = [
		"login:info",
		"login:email",
		"login:avatar"
	];
	const getUserInfo = async (tokens) => {
		const { data: profile, error } = await betterFetch("https://login.yandex.ru/info?format=json", {
			method: "GET",
			headers: { Authorization: `OAuth ${tokens.accessToken}` }
		});
		if (error || !profile) return null;
		return {
			id: profile.id,
			name: profile.display_name ?? profile.real_name ?? profile.first_name ?? profile.login,
			email: profile.default_email ?? profile.emails?.[0],
			emailVerified: false,
			image: !profile.is_avatar_empty && profile.default_avatar_id ? `https://avatars.yandex.net/get-yapic/${profile.default_avatar_id}/islands-200` : void 0
		};
	};
	return {
		providerId: "yandex",
		authorizationUrl: "https://oauth.yandex.com/authorize",
		tokenUrl: "https://oauth.yandex.com/token",
		clientId: options.clientId,
		clientSecret: options.clientSecret,
		scopes: options.scopes ?? defaultScopes,
		redirectURI: options.redirectURI,
		pkce: options.pkce,
		disableImplicitSignUp: options.disableImplicitSignUp,
		disableSignUp: options.disableSignUp,
		overrideUserInfo: options.overrideUserInfo,
		getUserInfo
	};
}
//#endregion
export { yandex };
