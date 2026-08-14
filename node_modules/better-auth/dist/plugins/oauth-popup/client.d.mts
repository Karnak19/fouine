import { POPUP_TOKEN_STORAGE_KEY } from "./constants.mjs";
import { OAUTH_POPUP_ERROR_CODES } from "./error-codes.mjs";
import { oauthPopup } from "./index.mjs";
import { BetterAuthClientOptions, ClientStore } from "@better-auth/core";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";
import { BetterFetch, BetterFetchPlugin } from "@better-fetch/fetch";

//#region src/plugins/oauth-popup/client.d.ts
/** Inputs for `authClient.signIn.popup`; mirror the redirect sign-in. */
interface SignInPopupOptions {
  /** Built-in social provider id (e.g. `"google"`). */
  provider?: string;
  /** Generic OAuth provider id (registered via `genericOAuth`). */
  providerId?: string;
  callbackURL?: string;
  errorCallbackURL?: string;
  newUserCallbackURL?: string;
  requestSignUp?: boolean;
  scopes?: string[];
  additionalData?: Record<string, unknown>;
  /** `window.open` feature string; defaults to a centered 500x600 window. */
  windowFeatures?: string;
  /** How long (ms) to wait for the popup to complete. Default 5 minutes. */
  timeoutMs?: number;
}
interface SignInPopupResult {
  data: {
    success: boolean;
  } | null;
  error: {
    code: string;
    message: string;
    status?: number;
  } | null;
}
/** Reads the stored popup token (browser-only; null otherwise). */
declare function getStoredPopupToken(): string | null;
/**
 * Attaches the popup token as a bearer header when embedded (where the cookie is
 * partitioned), and clears it once the session ends so it can't be reused.
 */
declare const popupBearerFetchPlugin: BetterFetchPlugin;
interface SignInPopupDeps {
  $fetch: BetterFetch;
  options?: BetterAuthClientOptions | undefined;
  /** Refreshes the reactive session, as the redirect flow's atom listeners do. */
  notifySessionSignal: () => void;
}
/**
 * Builds `signIn.popup`. Runs the sign-in in the popup's own first-party
 * context (so the OAuth state cookie lands there), waits for the completion
 * page to post the session token back, stores it for the bearer fetch plugin,
 * and refreshes the reactive session.
 */
declare function createSignInPopup({
  $fetch,
  options,
  notifySessionSignal
}: SignInPopupDeps): (opts: SignInPopupOptions) => Promise<SignInPopupResult>;
/**
 * Client plugin for popup OAuth sign-in. Adds `authClient.signIn.popup`. Pair
 * with the server `oauthPopup` and `bearer` plugins.
 */
declare const oauthPopupClient: () => {
  id: "oauth-popup";
  version: string;
  $InferServerPlugin: ReturnType<typeof oauthPopup>;
  $ERROR_CODES: {
    POPUP_SIGN_IN_FAILED: _better_auth_core_utils_error_codes0.RawError<"POPUP_SIGN_IN_FAILED">;
    POPUP_BLOCKED: _better_auth_core_utils_error_codes0.RawError<"POPUP_BLOCKED">;
    POPUP_CLOSED: _better_auth_core_utils_error_codes0.RawError<"POPUP_CLOSED">;
    POPUP_TIMEOUT: _better_auth_core_utils_error_codes0.RawError<"POPUP_TIMEOUT">;
  };
  fetchPlugins: BetterFetchPlugin[];
  getActions: ($fetch: BetterFetch, $store: ClientStore, options: BetterAuthClientOptions | undefined) => {
    signIn: {
      popup: (opts: SignInPopupOptions) => Promise<SignInPopupResult>;
    };
  };
};
//#endregion
export { SignInPopupOptions, SignInPopupResult, createSignInPopup, getStoredPopupToken, oauthPopupClient, popupBearerFetchPlugin };