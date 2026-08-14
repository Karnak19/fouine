import { ExtractPluginField, HasRequiredKeys, InferPluginFieldFromTuple, IsAny, OverrideMerge, Prettify, PrettifyDeep, RequiredKeysOf, StripEmptyObjects, UnionToIntersection } from "../../types/helper.mjs";
import { InferActions, InferClientAPI, InferErrorCodes, IsSignal, SessionQueryParams } from "../types.mjs";
import { getClientConfig } from "../config.mjs";
import { useStore } from "./react-store.mjs";
import { BetterAuthClientOptions } from "@better-auth/core";
import { BASE_ERROR_CODES } from "@better-auth/core/error";
import { BetterFetchError, BetterFetchResponse } from "@better-fetch/fetch";
export * from "nanostores";
export * from "@better-fetch/fetch";

//#region src/client/react/index.d.ts
type InferResolvedHooks<O extends BetterAuthClientOptions> = O extends {
  plugins: Array<infer Plugin>;
} ? UnionToIntersection<Plugin extends {
  getAtoms?: infer GetAtoms;
} ? GetAtoms extends ((fetch: any) => infer Atoms) ? Atoms extends Record<string, any> ? { [key in keyof Atoms as IsSignal<key> extends true ? never : key extends string ? `use${Capitalize<key>}` : never]: () => ReturnType<Atoms[key]["get"]> } : {} : {} : {}> : {};
type ClientConfig = ReturnType<typeof getClientConfig>;
type ClientSession<Option extends BetterAuthClientOptions> = InferClientAPI<Option> extends {
  getSession: () => Promise<infer Res>;
} ? Res extends BetterFetchResponse<infer S> ? S : Res : never;
/**
 * React client returned by `createAuthClient`.
 */
type ReactAuthClient<Option extends BetterAuthClientOptions> = UnionToIntersection<InferResolvedHooks<Option>> & InferClientAPI<Option> & InferActions<Option> & {
  useSession: () => {
    data: ClientSession<Option>;
    isPending: boolean;
    isRefetching: boolean;
    error: BetterFetchError | null;
    refetch: (queryParams?: {
      query?: SessionQueryParams;
    } | undefined) => Promise<void>;
  };
  $Infer: {
    Session: NonNullable<ClientSession<Option>>;
  };
  $fetch: ClientConfig["$fetch"];
  $store: ClientConfig["$store"];
  $ERROR_CODES: InferErrorCodes<Option> & typeof BASE_ERROR_CODES;
};
declare function createAuthClient<Option extends BetterAuthClientOptions>(options?: Option | undefined): ReactAuthClient<Option>;
//#endregion
export { ExtractPluginField, HasRequiredKeys, InferPluginFieldFromTuple, IsAny, OverrideMerge, Prettify, PrettifyDeep, ReactAuthClient, RequiredKeysOf, StripEmptyObjects, type UnionToIntersection, createAuthClient, useStore };