import { isJsonEqual, withEquality } from "./equality.mjs";
import { atom, onMount } from "nanostores";
//#region src/client/query.ts
const isServer = () => typeof window === "undefined";
function isAuthQueryStateEqual(a, b) {
	return isJsonEqual(a.data, b.data) && a.error === b.error && a.isPending === b.isPending && a.isRefetching === b.isRefetching && a.refetch === b.refetch;
}
const useAuthQuery = (initializedAtom, path, $fetch, options) => {
	const value = atom({
		data: null,
		error: null,
		isPending: true,
		isRefetching: false,
		refetch: (queryParams) => fn(queryParams)
	});
	withEquality(value, isAuthQueryStateEqual);
	const fn = async (queryParams) => {
		return new Promise((resolve) => {
			const opts = typeof options === "function" ? options({
				data: value.get().data,
				error: value.get().error,
				isPending: value.get().isPending
			}) : options;
			$fetch(path, {
				...opts,
				query: {
					...opts?.query,
					...queryParams?.query
				},
				async onSuccess(context) {
					const current = value.get();
					const stableData = current.data != null && context.data != null && isJsonEqual(current.data, context.data) ? current.data : context.data;
					value.set({
						data: stableData,
						error: null,
						isPending: false,
						isRefetching: false,
						refetch: value.value.refetch
					});
					await opts?.onSuccess?.(context);
				},
				async onError(context) {
					const { request } = context;
					const retryAttempts = typeof request.retry === "number" ? request.retry : request.retry?.attempts;
					const retryAttempt = request.retryAttempt || 0;
					if (retryAttempts && retryAttempt < retryAttempts) return;
					const isUnauthorized = context.error.status === 401;
					value.set({
						error: context.error,
						data: isUnauthorized ? null : value.get().data,
						isPending: false,
						isRefetching: false,
						refetch: value.value.refetch
					});
					await opts?.onError?.(context);
				},
				async onRequest(context) {
					const currentValue = value.get();
					value.set({
						isPending: currentValue.data === null,
						data: currentValue.data,
						error: null,
						isRefetching: true,
						refetch: value.value.refetch
					});
					await opts?.onRequest?.(context);
				}
			}).catch((error) => {
				value.set({
					error,
					data: value.get().data,
					isPending: false,
					isRefetching: false,
					refetch: value.value.refetch
				});
			}).finally(() => {
				resolve(void 0);
			});
		});
	};
	initializedAtom = Array.isArray(initializedAtom) ? initializedAtom : [initializedAtom];
	let isInitialized = false;
	const cleanups = [];
	for (const initAtom of initializedAtom) {
		const unbind = initAtom.subscribe(async () => {
			if (isServer()) return;
			if (isInitialized) await fn();
			else onMount(value, () => {
				const timeoutId = setTimeout(async () => {
					if (!isInitialized) {
						isInitialized = true;
						await fn();
					}
				}, 0);
				return () => {
					for (const u of cleanups) u();
					clearTimeout(timeoutId);
				};
			});
		});
		cleanups.push(unbind);
	}
	return value;
};
//#endregion
export { useAuthQuery };
