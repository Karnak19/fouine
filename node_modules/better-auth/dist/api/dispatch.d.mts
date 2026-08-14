import { AuthContext } from "@better-auth/core";
import { Endpoint, EndpointContext, InputContext } from "better-call";

//#region src/api/dispatch.d.ts
/**
 * Input accepted by {@link dispatchAuthEndpoint}. `context` must already be a
 * resolved `AuthContext`; the caller owns `baseURL` resolution. A fresh
 * dispatch carries no `session` (the shared context has none), while a resumed
 * dispatch carries the in-flight request's `session` through.
 */
type DispatchContext = Partial<InputContext<string, any> & EndpointContext<string, any>> & {
  context: AuthContext & {
    returned?: unknown | undefined;
    responseHeaders?: Headers | undefined;
  };
  operationId?: string | undefined;
};
/**
 * Run a single endpoint through the configured `hooks.before` / `hooks.after`
 * pipeline, normalizing the response, headers, and `APIError`s the same way a
 * router or `auth.api.*` dispatch does.
 *
 * This is the canonical hook runner. The HTTP router and `auth.api.*` reach it
 * through {@link toAuthEndpoints}. Plugins call it directly when they need to
 * re-enter the pipeline on purpose, such as resuming `/oauth2/authorize` after
 * a fresh sign-in. Calling an endpoint as a plain function deliberately skips
 * hooks; `dispatchAuthEndpoint` is the supported way to opt back in.
 *
 * @param endpoint The endpoint to dispatch.
 * @param input Input context whose `context` is an already-resolved `AuthContext`.
 */
declare function dispatchAuthEndpoint(endpoint: Endpoint, input: DispatchContext): Promise<unknown>;
//#endregion
export { DispatchContext, dispatchAuthEndpoint };