import { getOrigin, trimTrailingSlashes } from "../../utils/url.mjs";
import { env } from "@better-auth/core/env";
//#region src/plugins/oauth-proxy/utils.ts
/**
* Strip trailing slashes from URL to prevent double slashes
*/
function stripTrailingSlash(url) {
	if (!url) return "";
	return trimTrailingSlashes(url);
}
/**
* Get base URL from vendor-specific environment variables
*/
function getVendorBaseURL() {
	const vercel = env.VERCEL_URL ? `https://${env.VERCEL_URL}` : void 0;
	const netlify = env.NETLIFY_URL;
	const render = env.RENDER_URL;
	const aws = env.AWS_LAMBDA_FUNCTION_NAME;
	const google = env.GOOGLE_CLOUD_FUNCTION_NAME;
	const azure = env.AZURE_FUNCTION_NAME;
	return vercel || netlify || render || aws || google || azure;
}
/**
* Resolve the current URL from various sources.
*
* The request URL host can come from an untrusted source (`Host` / forwarded host),
* and this origin becomes the receiver for the encrypted OAuth profile replay.
* So a request-derived origin is only honored when it is an explicitly trusted
* origin; otherwise resolution falls back to the configured platform/base URL,
* never the raw request host. An explicit `opts.currentURL` and the vendor/base
* URLs are configured by the developer and trusted as-is.
*/
function resolveCurrentURL(ctx, opts) {
	if (opts?.currentURL) return new URL(opts.currentURL);
	const requestURL = ctx.request?.url;
	if (requestURL) {
		const origin = getOrigin(requestURL);
		if (origin && ctx.context.isTrustedOrigin(origin)) return new URL(requestURL);
	}
	const vendorBaseURL = getVendorBaseURL();
	return new URL(vendorBaseURL && getOrigin(vendorBaseURL) ? vendorBaseURL : ctx.context.baseURL);
}
/**
* Check if the proxy should be skipped for this request
*/
function checkSkipProxy(ctx, opts) {
	if (ctx.request?.headers.get("x-skip-oauth-proxy")) return true;
	const productionURL = opts?.productionURL || env.BETTER_AUTH_URL || ctx.context.baseURL;
	if (!productionURL) return false;
	const currentURL = opts?.currentURL || ctx.request?.url || getVendorBaseURL();
	if (!currentURL) return false;
	return getOrigin(productionURL) === getOrigin(currentURL);
}
//#endregion
export { checkSkipProxy, resolveCurrentURL, stripTrailingSlash };
