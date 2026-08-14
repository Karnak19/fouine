import { getBaseURL } from "../../utils/url.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { POPUP_TOKEN_STORAGE_KEY } from "./constants.mjs";
import { OAUTH_POPUP_ERROR_CODES } from "./error-codes.mjs";
//#region src/plugins/oauth-popup/client.ts
const POPUP_NAME = "better-auth-oauth";
const POPUP_WIDTH = 500;
const POPUP_HEIGHT = 600;
const CLOSED_POLL_MS = 500;
const DEFAULT_TIMEOUT_MS = 300 * 1e3;
/** True when embedded cross-origin, where the cookie may be partitioned. */
function isEmbedded() {
	if (typeof window === "undefined" || window.self === window.top) return false;
	try {
		window.top?.location.href;
		return false;
	} catch {
		return true;
	}
}
/** Reads the stored popup token (browser-only; null otherwise). */
function getStoredPopupToken() {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage.getItem(POPUP_TOKEN_STORAGE_KEY);
	} catch {
		return null;
	}
}
function storePopupToken(token) {
	try {
		window.localStorage?.setItem(POPUP_TOKEN_STORAGE_KEY, token);
	} catch {}
}
function clearPopupToken() {
	try {
		window.localStorage?.removeItem(POPUP_TOKEN_STORAGE_KEY);
	} catch {}
}
/**
* Attaches the popup token as a bearer header when embedded (where the cookie is
* partitioned), and clears it once the session ends so it can't be reused.
*/
const popupBearerFetchPlugin = {
	id: "better-auth-popup-bearer",
	name: "Popup Bearer",
	hooks: {
		onRequest(context) {
			if (!isEmbedded()) return context;
			const token = getStoredPopupToken();
			if (!token) return context;
			const headers = new Headers(context.headers);
			if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
			return {
				...context,
				headers
			};
		},
		onSuccess(context) {
			const path = new URL(context.request.url).pathname;
			if (path.endsWith("/sign-out") || path.endsWith("/revoke-session") || path.endsWith("/revoke-sessions") || path.endsWith("/revoke-other-sessions") || path.endsWith("/delete-user")) clearPopupToken();
		}
	}
};
let activePopup = null;
function popupError(code, status) {
	return {
		data: null,
		error: {
			code,
			message: String(OAUTH_POPUP_ERROR_CODES[code]),
			...status ? { status } : {}
		}
	};
}
function centeredFeatures() {
	return `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${window.screenX + (window.outerWidth - POPUP_WIDTH) / 2},top=${window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2},menubar=no,toolbar=no`;
}
function randomNonce() {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
/**
* Resolves with the token (or relayed error) once the completion page posts
* back, gating on origin, type, and nonce.
*/
function waitForPopupResult(popup, expectedOrigin, nonce, timeoutMs) {
	return new Promise((resolve) => {
		let settled = false;
		const settle = (outcome) => {
			if (settled) return;
			settled = true;
			window.removeEventListener("message", onMessage);
			clearInterval(closedPoll);
			clearTimeout(timeout);
			try {
				if (!popup.closed) popup.close();
			} catch {}
			resolve(outcome);
		};
		const onMessage = (event) => {
			if (event.origin !== expectedOrigin) return;
			const data = event.data;
			if (data?.type !== "better-auth:oauth-popup") return;
			if (data.nonce !== nonce) return;
			if (data.error) {
				settle({
					status: "error",
					error: data.error
				});
				return;
			}
			if (typeof data.token !== "string" || !data.token) return;
			settle({
				status: "success",
				token: data.token
			});
		};
		const closedPoll = setInterval(() => {
			if (popup.closed) settle({ status: "cancelled" });
		}, CLOSED_POLL_MS);
		const timeout = setTimeout(() => settle({ status: "timeout" }), timeoutMs);
		window.addEventListener("message", onMessage);
	});
}
function resolveAuthURL(options) {
	const configured = getBaseURL(options?.baseURL, options?.basePath) ?? options?.basePath ?? "/api/auth";
	return new URL(configured, window.location.origin);
}
/**
* Builds `signIn.popup`. Runs the sign-in in the popup's own first-party
* context (so the OAuth state cookie lands there), waits for the completion
* page to post the session token back, stores it for the bearer fetch plugin,
* and refreshes the reactive session.
*/
function createSignInPopup({ $fetch, options, notifySessionSignal }) {
	return async function signInPopup(opts) {
		if (typeof window === "undefined") return popupError("POPUP_SIGN_IN_FAILED");
		const { provider, providerId, additionalData, windowFeatures, timeoutMs = DEFAULT_TIMEOUT_MS, callbackURL, errorCallbackURL, newUserCallbackURL, scopes, requestSignUp } = opts;
		if (!provider && !providerId) return popupError("POPUP_SIGN_IN_FAILED");
		if (activePopup && !activePopup.closed) {
			activePopup.focus();
			return popupError("POPUP_SIGN_IN_FAILED");
		}
		const nonce = randomNonce();
		const authUrl = resolveAuthURL(options);
		const authOrigin = authUrl.origin;
		const startUrl = new URL(`${authUrl.href.replace(/\/$/, "")}/oauth-popup/start`);
		startUrl.searchParams.set("provider", provider ?? providerId);
		startUrl.searchParams.set("popupOrigin", window.location.origin);
		startUrl.searchParams.set("popupNonce", nonce);
		if (callbackURL) startUrl.searchParams.set("callbackURL", callbackURL);
		if (errorCallbackURL) startUrl.searchParams.set("errorCallbackURL", errorCallbackURL);
		if (newUserCallbackURL) startUrl.searchParams.set("newUserCallbackURL", newUserCallbackURL);
		if (scopes?.length) startUrl.searchParams.set("scopes", scopes.join(","));
		if (requestSignUp) startUrl.searchParams.set("requestSignUp", "true");
		if (additionalData) startUrl.searchParams.set("additionalData", JSON.stringify(additionalData));
		const popup = window.open(startUrl.toString(), POPUP_NAME, windowFeatures ?? centeredFeatures());
		if (!popup) return popupError("POPUP_BLOCKED");
		activePopup = popup;
		const outcome = await waitForPopupResult(popup, authOrigin, nonce, timeoutMs);
		activePopup = null;
		if (outcome.status === "timeout") return popupError("POPUP_TIMEOUT");
		if (outcome.status === "cancelled") return popupError("POPUP_CLOSED");
		if (outcome.status === "error") return {
			data: null,
			error: {
				code: outcome.error.code,
				message: outcome.error.description || outcome.error.code
			}
		};
		if (isEmbedded()) storePopupToken(outcome.token);
		else clearPopupToken();
		const session = await $fetch("/get-session");
		if (session.error || !session.data) return popupError("POPUP_SIGN_IN_FAILED", session.error?.status);
		notifySessionSignal();
		return {
			data: { success: true },
			error: null
		};
	};
}
/**
* Client plugin for popup OAuth sign-in. Adds `authClient.signIn.popup`. Pair
* with the server `oauthPopup` and `bearer` plugins.
*/
const oauthPopupClient = () => {
	return {
		id: "oauth-popup",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {},
		$ERROR_CODES: OAUTH_POPUP_ERROR_CODES,
		fetchPlugins: [popupBearerFetchPlugin],
		getActions: ($fetch, $store, options) => ({ signIn: { popup: createSignInPopup({
			$fetch,
			options,
			notifySessionSignal: () => $store.notify("$sessionSignal")
		}) } })
	};
};
//#endregion
export { createSignInPopup, getStoredPopupToken, oauthPopupClient, popupBearerFetchPlugin };
