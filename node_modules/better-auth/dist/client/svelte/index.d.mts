import { ExtractPluginField, HasRequiredKeys, InferPluginFieldFromTuple, IsAny, OverrideMerge, Prettify, PrettifyDeep, RequiredKeysOf, StripEmptyObjects, UnionToIntersection } from "../../types/helper.mjs";
import { InferActions, InferClientAPI, InferErrorCodes, IsSignal, SessionQueryParams } from "../types.mjs";
import { getClientConfig } from "../config.mjs";
import { BetterAuthClientOptions } from "@better-auth/core";
import { BASE_ERROR_CODES } from "@better-auth/core/error";
import { Atom } from "nanostores";
import { BetterFetchError, BetterFetchResponse } from "@better-fetch/fetch";
export * from "nanostores";
export * from "@better-fetch/fetch";

//#region src/client/svelte/index.d.ts
type InferResolvedHooks<O extends BetterAuthClientOptions> = O extends {
  plugins: Array<infer Plugin>;
} ? UnionToIntersection<Plugin extends {
  getAtoms?: infer GetAtoms;
} ? GetAtoms extends ((fetch: any) => infer Atoms) ? Atoms extends Record<string, any> ? { [key in keyof Atoms as IsSignal<key> extends true ? never : key extends string ? `use${Capitalize<key>}` : never]: () => Atoms[key] } : {} : {} : {}> : {};
type ClientConfig = ReturnType<typeof getClientConfig>;
type ClientSession<Option extends BetterAuthClientOptions> = InferClientAPI<Option> extends {
  getSession: () => Promise<infer Res>;
} ? Res extends BetterFetchResponse<infer S> ? S : Res extends Record<string, any> ? Res : never : never;
/**
 * Svelte client returned by `createAuthClient`.
 */
type SvelteAuthClient<Option extends BetterAuthClientOptions> = UnionToIntersection<InferResolvedHooks<Option>> & InferClientAPI<Option> & InferActions<Option> & {
  useSession: () => Atom<{
    data: ClientSession<Option>;
    error: BetterFetchError | null;
    isPending: boolean;
    isRefetching: boolean;
    refetch: (queryParams?: {
      query?: SessionQueryParams;
    } | undefined) => Promise<void>;
  }>;
  $fetch: ClientConfig["$fetch"];
  $store: ClientConfig["$store"];
  $Infer: {
    Session: NonNullable<ClientSession<Option>>;
  };
  $ERROR_CODES: PrettifyDeep<InferErrorCodes<Option> & typeof BASE_ERROR_CODES>;
};
declare function createAuthClient<Option extends BetterAuthClientOptions>(options?: Option | undefined): SvelteAuthClient<Option>;
//#endregion
export { ExtractPluginField, HasRequiredKeys, InferPluginFieldFromTuple, IsAny, OverrideMerge, Prettify, PrettifyDeep, RequiredKeysOf, StripEmptyObjects, SvelteAuthClient, type UnionToIntersection, createAuthClient };