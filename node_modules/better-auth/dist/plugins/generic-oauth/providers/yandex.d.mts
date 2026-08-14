import { GenericOAuthConfig } from "../types.mjs";
import { BaseOAuthProviderOptions } from "../index.mjs";

//#region src/plugins/generic-oauth/providers/yandex.d.ts
interface YandexOptions extends BaseOAuthProviderOptions {}
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
declare function yandex(options: YandexOptions): GenericOAuthConfig;
//#endregion
export { YandexOptions, yandex };