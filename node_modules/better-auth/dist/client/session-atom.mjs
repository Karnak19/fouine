import { isJsonEqual, withEquality } from "./equality.mjs";
import { createSessionRefreshManager } from "./session-refresh.mjs";
import { atom, onMount } from "nanostores";
//#region src/client/session-atom.ts
const isServer = () => typeof window === "undefined";
/**
* Normalize $fetch response: `throw: true` returns data directly,
* otherwise `{ data, error }`.
*/
function normalizeSessionResponse(res) {
	if (typeof res === "object" && res !== null && "data" in res && "error" in res) return res;
	return {
		data: res,
		error: null
	};
}
function normalizeSessionData(data) {
	if (!data) return null;
	if (data.session === null && data.user === null) return null;
	return data;
}
function isSessionAtomEqual(a, b) {
	return isJsonEqual(a.data, b.data) && a.error === b.error && a.isPending === b.isPending && a.isRefetching === b.isRefetching && a.refetch === b.refetch;
}
function getSessionAtom($fetch, options) {
	const $signal = atom(false);
	let abortController;
	const refetch = (queryParams) => fetchSession(queryParams);
	const session = atom({
		data: null,
		error: null,
		isPending: true,
		isRefetching: false,
		refetch
	});
	withEquality(session, isSessionAtomEqual);
	const settleAbortedFetch = (controller) => {
		if (abortController !== controller) return;
		const current = session.get();
		abortController = void 0;
		if (!current.isPending && !current.isRefetching) return;
		session.set({
			...current,
			isPending: false,
			isRefetching: false,
			refetch
		});
	};
	const fetchSession = async (queryParams) => {
		abortController?.abort();
		const controller = new AbortController();
		abortController = controller;
		const current = session.get();
		session.set({
			...current,
			isPending: current.data === null,
			isRefetching: true,
			error: null,
			refetch
		});
		try {
			const res = await $fetch("/get-session", {
				method: "GET",
				query: queryParams?.query,
				signal: controller.signal
			});
			if (controller.signal.aborted) {
				settleAbortedFetch(controller);
				return;
			}
			let { data, error } = normalizeSessionResponse(res);
			if (data?.needsRefresh) try {
				const refreshRes = await $fetch("/get-session", {
					method: "POST",
					signal: controller.signal
				});
				if (controller.signal.aborted) {
					settleAbortedFetch(controller);
					return;
				}
				({data, error} = normalizeSessionResponse(refreshRes));
			} catch {
				if (controller.signal.aborted) {
					settleAbortedFetch(controller);
					return;
				}
			}
			if (error) {
				const latest = session.get();
				const isUnauthorized = error?.status === 401;
				session.set({
					data: isUnauthorized ? null : latest.data,
					error,
					isPending: false,
					isRefetching: false,
					refetch
				});
				return;
			}
			const sessionData = normalizeSessionData(data);
			const current = session.get();
			const stableData = current.data != null && sessionData != null && isJsonEqual(current.data, sessionData) ? current.data : sessionData;
			session.set({
				data: stableData,
				error: null,
				isPending: false,
				isRefetching: false,
				refetch
			});
		} catch (fetchError) {
			if (controller.signal.aborted) {
				settleAbortedFetch(controller);
				return;
			}
			const latest = session.get();
			session.set({
				data: latest.data,
				error: fetchError,
				isPending: false,
				isRefetching: false,
				refetch
			});
		}
	};
	let broadcastSessionUpdate = () => {};
	onMount(session, () => {
		let timeoutId;
		if (!isServer()) timeoutId = setTimeout(() => {
			fetchSession();
		}, 0);
		const refreshManager = createSessionRefreshManager({
			fetchSession,
			shouldPollSession: () => session.get().data != null,
			sessionSignal: $signal,
			options
		});
		refreshManager.init();
		broadcastSessionUpdate = refreshManager.broadcastSessionUpdate;
		return () => {
			if (timeoutId) clearTimeout(timeoutId);
			const controller = abortController;
			controller?.abort();
			if (controller) settleAbortedFetch(controller);
			refreshManager.cleanup();
		};
	});
	return {
		session,
		$sessionSignal: $signal,
		broadcastSessionUpdate: (trigger) => broadcastSessionUpdate(trigger)
	};
}
//#endregion
export { getSessionAtom };
