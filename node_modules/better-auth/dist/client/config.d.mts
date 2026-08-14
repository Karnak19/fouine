import { BetterAuthClientOptions, ClientAtomListener } from "@better-auth/core";
import { WritableAtom } from "nanostores";
import * as _better_fetch_fetch0 from "@better-fetch/fetch";

//#region src/client/config.d.ts
declare const getClientConfig: (options?: BetterAuthClientOptions | undefined, loadEnv?: boolean | undefined) => {
  readonly baseURL: string;
  pluginsActions: Record<string, any>;
  pluginsAtoms: Record<string, WritableAtom<any>>;
  pluginPathMethods: Record<string, "GET" | "POST">;
  atomListeners: ClientAtomListener[];
  $fetch: _better_fetch_fetch0.BetterFetch<{
    plugins: (_better_fetch_fetch0.BetterFetchPlugin<Record<string, any>> | {
      id: string;
      name: string;
      hooks: {
        onSuccess(context: _better_fetch_fetch0.SuccessContext<any>): void;
      };
    } | {
      id: string;
      name: string;
      hooks: {
        onSuccess: ((context: _better_fetch_fetch0.SuccessContext<any>) => Promise<void> | void) | undefined;
        onError: ((context: _better_fetch_fetch0.ErrorContext) => Promise<void> | void) | undefined;
        onRequest: (<T extends Record<string, any>>(context: _better_fetch_fetch0.RequestContext<T>) => Promise<_better_fetch_fetch0.RequestContext | void> | _better_fetch_fetch0.RequestContext | void) | undefined;
        onResponse: ((context: _better_fetch_fetch0.ResponseContext) => Promise<Response | void | _better_fetch_fetch0.ResponseContext> | Response | _better_fetch_fetch0.ResponseContext | void) | undefined;
      };
    })[];
    priority?: RequestPriority | undefined;
    cache?: RequestCache | undefined;
    credentials?: RequestCredentials;
    integrity?: string | undefined;
    keepalive?: boolean | undefined;
    method: string;
    mode?: RequestMode | undefined;
    redirect?: RequestRedirect | undefined;
    referrer?: string | undefined;
    referrerPolicy?: ReferrerPolicy | undefined;
    signal?: (AbortSignal | null) | undefined;
    window?: null | undefined;
    onRetry?: ((response: _better_fetch_fetch0.ResponseContext) => Promise<void> | void) | undefined;
    hookOptions?: {
      cloneResponse?: boolean;
    } | undefined;
    timeout?: number | undefined;
    customFetchImpl: _better_fetch_fetch0.FetchEsque;
    baseURL: string;
    throw?: boolean | undefined;
    auth?: ({
      type: "Bearer";
      token: string | Promise<string | undefined> | (() => string | Promise<string | undefined> | undefined) | undefined;
    } | {
      type: "Basic";
      username: string | (() => string | undefined) | undefined;
      password: string | (() => string | undefined) | undefined;
    } | {
      type: "Custom";
      prefix: string | (() => string | undefined) | undefined;
      value: string | (() => string | undefined) | undefined;
    }) | undefined;
    headers?: {} | {
      [x: string]: string | undefined;
      accept?: ((string & {}) | "application/json" | "text/plain" | "application/octet-stream") | undefined;
      "content-type"?: ((string & {}) | "application/x-www-form-urlencoded" | "application/json" | "text/plain" | "application/octet-stream" | "multipart/form-data") | undefined;
      authorization?: ((string & {}) | `Bearer ${string}` | `Basic ${string}`) | undefined;
    } | undefined;
    body?: any;
    query?: any;
    params?: any;
    duplex?: "full" | "half" | undefined;
    jsonParser: (text: string) => Promise<any> | any;
    retry?: _better_fetch_fetch0.RetryOptions | undefined;
    retryAttempt?: number | undefined;
    output?: (_better_fetch_fetch0.StandardSchemaV1 | typeof Blob | typeof File) | undefined;
    errorSchema?: _better_fetch_fetch0.StandardSchemaV1 | undefined;
    disableValidation?: boolean | undefined;
    disableSignal?: boolean | undefined;
  }, unknown, unknown, {}>;
  $store: {
    notify: (signal?: (Omit<string, "$sessionSignal"> | "$sessionSignal") | undefined) => void;
    listen: (signal: Omit<string, "$sessionSignal"> | "$sessionSignal", listener: (value: boolean, oldValue?: boolean | undefined) => void) => void;
    atoms: Record<string, WritableAtom<any>>;
  };
};
//#endregion
export { getClientConfig };