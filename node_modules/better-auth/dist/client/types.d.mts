import { InferFieldsInputClient } from "../db/field.mjs";
import { StripEmptyObjects, UnionToIntersection } from "../types/helper.mjs";
import { InferRoutes } from "./path-to-object.mjs";
import { Session as Session$1, User as User$1 } from "../types/models.mjs";
import { Auth } from "../types/auth.mjs";
import { BetterAuthClientOptions as BetterAuthClientOptions$1, BetterAuthClientPlugin, ClientAtomListener as ClientAtomListener$1, ClientStore as ClientStore$1 } from "@better-auth/core";
import { DBFieldAttribute, InferDBFieldsOutput } from "@better-auth/core/db";

//#region src/client/types.d.ts
type ClientPluginError<K extends string = string> = {
  readonly code: K;
  message: string;
};
type InferPluginEndpoints<Plugins> = Plugins extends Array<infer Pl> ? UnionToIntersection<Pl extends {
  $InferServerPlugin?: infer Plug;
} ? Plug extends {
  endpoints?: infer Endpoints;
} ? Endpoints extends Record<string, unknown> ? Endpoints : {} : {} : {}> : {};
type InferClientAPI<O extends BetterAuthClientOptions$1> = InferRoutes<O["plugins"] extends Array<any> ? Omit<Auth["api"], keyof InferPluginEndpoints<O["plugins"]>> & InferPluginEndpoints<O["plugins"]> : Auth["api"], O>;
type InferActions<O extends BetterAuthClientOptions$1> = (O["plugins"] extends Array<infer Plugin> ? UnionToIntersection<Plugin extends {
  getActions?: infer GetActions;
} ? GetActions extends ((...args: any) => infer Actions) ? Actions : {} : {}> : {}) & InferRoutes<O["$InferAuth"] extends {
  plugins: infer Plugins;
} ? Plugins extends Array<infer Plugin> ? Plugin extends {
  endpoints?: infer Endpoints;
} ? Endpoints extends Record<string, unknown> ? Endpoints : {} : {} : {} : {}, O>;
type InferErrorCodes<O extends BetterAuthClientOptions$1> = O["plugins"] extends Array<infer Plugin> ? UnionToIntersection<Plugin extends {
  $InferServerPlugin?: infer ServerPlugin;
} ? ServerPlugin extends {
  $ERROR_CODES?: infer E;
} ? { [K in keyof E & string]: E[K] extends ClientPluginError ? ClientPluginError<K> : never } : {} : {}> : {};
/**
 * signals are just used to recall a computed value.
 * as a convention they start with "$"
 */
type IsSignal<T> = T extends `$${infer _}` ? true : false;
type InferSessionFromClient<O extends BetterAuthClientOptions$1> = StripEmptyObjects<Session$1 & UnionToIntersection<InferAdditionalFromClient<O, "session", "output">>>;
type InferUserFromClient<O extends BetterAuthClientOptions$1> = StripEmptyObjects<User$1 & UnionToIntersection<InferAdditionalFromClient<O, "user", "output">>>;
type InferAdditionalFromClient<Options extends BetterAuthClientOptions$1, Key extends string, Format extends "input" | "output" = "output"> = Options["plugins"] extends Array<infer Plugin> ? Plugin extends {
  $InferServerPlugin?: infer ServerPlugin;
} ? ServerPlugin extends {
  schema?: infer Schema;
} ? Schema extends Record<Key, {
  fields: infer Fields;
}> ? Fields extends Record<string, DBFieldAttribute> ? Format extends "input" ? InferFieldsInputClient<Fields> : InferDBFieldsOutput<Fields> : {} : {} : {} : {} : {};
type SessionQueryParams = {
  disableCookieCache?: boolean | undefined;
  disableRefresh?: boolean | undefined;
};
//#endregion
export { type BetterAuthClientOptions$1 as BetterAuthClientOptions, type BetterAuthClientPlugin, type ClientAtomListener$1 as ClientAtomListener, type ClientStore$1 as ClientStore, InferActions, InferAdditionalFromClient, InferClientAPI, InferErrorCodes, InferSessionFromClient, InferUserFromClient, IsSignal, SessionQueryParams };