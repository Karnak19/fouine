import { getBaseURL, getOrigin, isDynamicBaseURLConfig } from "../utils/url.mjs";
import { getTrustedOrigins, getTrustedProviders, resolveDynamicTrustedProxyHeaders, resolveRequestContext } from "../context/helpers.mjs";
import { getEndpoints, router } from "../api/index.mjs";
import { runWithAdapter } from "@better-auth/core/context";
import { BASE_ERROR_CODES, BetterAuthError } from "@better-auth/core/error";
//#region src/auth/base.ts
const createBetterAuth = (options, initFn) => {
	const authContext = initFn(options);
	const { api } = getEndpoints(authContext, options);
	return {
		handler: async (request) => {
			const ctx = await authContext;
			const basePath = ctx.options.basePath || "/api/auth";
			let handlerCtx;
			if (isDynamicBaseURLConfig(options.baseURL)) handlerCtx = await resolveRequestContext(ctx, request, resolveDynamicTrustedProxyHeaders(ctx.options));
			else {
				handlerCtx = Object.create(Object.getPrototypeOf(ctx), Object.getOwnPropertyDescriptors(ctx));
				let trustOptions = ctx.options;
				if (!ctx.options.baseURL) {
					const baseURL = getBaseURL(void 0, basePath, request, void 0, ctx.options.advanced?.trustedProxyHeaders);
					if (!baseURL) throw new BetterAuthError("Could not get base URL from request. Please provide a valid base URL.");
					handlerCtx.baseURL = baseURL;
					handlerCtx.options = {
						...ctx.options,
						baseURL: getOrigin(baseURL) || void 0
					};
					trustOptions = handlerCtx.options;
				}
				handlerCtx.trustedOrigins = await getTrustedOrigins(trustOptions, request);
				handlerCtx.trustedProviders = await getTrustedProviders(trustOptions, request);
			}
			const { handler } = router(handlerCtx, options);
			return runWithAdapter(handlerCtx.adapter, () => handler(request));
		},
		api,
		options,
		$context: authContext,
		$ERROR_CODES: {
			...options.plugins?.reduce((acc, plugin) => {
				if (plugin.$ERROR_CODES) return {
					...acc,
					...plugin.$ERROR_CODES
				};
				return acc;
			}, {}),
			...BASE_ERROR_CODES
		}
	};
};
//#endregion
export { createBetterAuth };
