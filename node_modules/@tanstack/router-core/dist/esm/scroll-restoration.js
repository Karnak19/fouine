import { locationHistoryActions } from "./router.js";
import { isServer } from "@tanstack/router-core/isServer";
//#region src/scroll-restoration.ts
function getSafeSessionStorage() {
	try {
		return sessionStorage;
	} catch {
		return;
	}
}
const storageKey = "tsr-scroll-restoration-v1_3";
const safeSessionStorage = getSafeSessionStorage();
function createScrollRestorationCache() {
	try {
		return JSON.parse(safeSessionStorage?.getItem("tsr-scroll-restoration-v1_3") || "{}");
	} catch {
		return {};
	}
}
function persistScrollRestorationCache() {
	try {
		safeSessionStorage?.setItem(storageKey, JSON.stringify(scrollRestorationCache));
	} catch {
		if (process.env.NODE_ENV !== "production") console.warn("[ts-router] Could not persist scroll restoration state to sessionStorage.");
	}
}
const scrollRestorationCache = /* @__PURE__ */ createScrollRestorationCache();
const scrollRestorationIdAttribute = "data-scroll-restoration-id";
/**
* The default `getKey` function for `useScrollRestoration`.
* It returns the `key` from the location state or the `href` of the location.
*
* The `location.href` is used as a fallback to support the use case where the location state is not available like the initial render.
*/
const defaultGetScrollRestorationKey = (location) => {
	return location.state.__TSR_key || location.href;
};
function getScrollRestorationSelector(element) {
	const attrId = element.getAttribute(scrollRestorationIdAttribute);
	if (attrId) return `[${scrollRestorationIdAttribute}="${attrId}"]`;
	let selector = "";
	let el = element;
	let parent;
	while (parent = el.parentNode) {
		let index = 1;
		let sibling = el;
		while (sibling = sibling.previousElementSibling) index++;
		const part = `${el.localName}:nth-child(${index})`;
		selector = selector ? `${part} > ${selector}` : part;
		el = parent;
	}
	return selector;
}
function getElementScrollRestorationEntry(router, options) {
	const entries = scrollRestorationCache[(options.getKey || defaultGetScrollRestorationKey)(router.latestLocation)];
	if (!entries) return;
	if (options.id) return entries[`[${scrollRestorationIdAttribute}="${options.id}"]`];
	const element = options.getElement?.();
	if (!element) return;
	return entries[element === window ? windowScrollTarget : getScrollRestorationSelector(element)];
}
let ignoreScroll = false;
const windowScrollTarget = "window";
function getElement(selector) {
	try {
		return typeof selector === "function" ? selector() : document.querySelector(selector);
	} catch {}
}
function getScrollToTopElements(scrollToTopSelectors) {
	const elements = [];
	for (const selector of scrollToTopSelectors) {
		if (selector === windowScrollTarget) continue;
		const element = getElement(selector);
		if (element) elements.push(element);
	}
	return elements;
}
function setupScrollRestoration(router, force) {
	const shouldSetupScrollRestoration = force ?? router.options.scrollRestoration;
	const scroll = router._scroll;
	if (shouldSetupScrollRestoration) scroll.restoring = true;
	if (isServer ?? router.isServer) return;
	const getKey = router.options.getScrollRestorationKey || defaultGetScrollRestorationKey;
	const trackedScrollEntries = /* @__PURE__ */ new Map();
	const setTrackedScrollEntry = (target, scrollX, scrollY) => {
		const entry = trackedScrollEntries.get(target) || {};
		entry.scrollX = scrollX;
		entry.scrollY = scrollY;
		trackedScrollEntries.set(target, entry);
	};
	const onScroll = (event) => {
		if (ignoreScroll || !scroll.restoring) return;
		if (event.target === document) setTrackedScrollEntry(windowScrollTarget, scrollX, scrollY);
		else {
			const target = event.target;
			setTrackedScrollEntry(target, target.scrollLeft, target.scrollTop);
		}
	};
	const snapshotCurrentScrollTargets = (restoreKey) => {
		if (!scroll.restoring) return;
		const keyEntry = scrollRestorationCache[restoreKey] ||= {};
		for (const [target, position] of trackedScrollEntries) if (target === windowScrollTarget) keyEntry[windowScrollTarget] = position;
		else if (target.isConnected) keyEntry[getScrollRestorationSelector(target)] = position;
	};
	if (shouldSetupScrollRestoration && !scroll.restoration) {
		scroll.restoration = true;
		ignoreScroll = false;
		history.scrollRestoration = "manual";
		document.addEventListener("scroll", onScroll, true);
		router.subscribe("onBeforeLoad", (event) => {
			if (event.fromLocation) snapshotCurrentScrollTargets(getKey(event.fromLocation));
			trackedScrollEntries.clear();
		});
		addEventListener("pagehide", () => {
			snapshotCurrentScrollTargets(getKey(router.stores.resolvedLocation.get() ?? router.stores.location.get()));
			persistScrollRestorationCache();
		});
	}
	if (scroll.reset) return;
	scroll.reset = true;
	router.subscribe("onRendered", (event) => {
		const behavior = router.options.scrollRestorationBehavior;
		const scrollToTopSelectors = router.options.scrollToTopSelectors;
		const shouldResetScroll = scroll.next;
		let scrollToTopElements;
		trackedScrollEntries.clear();
		if (!shouldResetScroll) scroll.next = true;
		if (typeof router.options.scrollRestoration === "function" && !router.options.scrollRestoration({ location: router.latestLocation })) return;
		const cacheKey = getKey(event.toLocation);
		const fromCacheKey = event.fromLocation && getKey(event.fromLocation);
		if (scroll.restoring && fromCacheKey && fromCacheKey !== cacheKey) {
			const fromElementEntries = scrollRestorationCache[fromCacheKey];
			if (fromElementEntries) {
				let toElementEntries = scrollRestorationCache[cacheKey];
				for (const elementSelector in fromElementEntries) {
					if (elementSelector === windowScrollTarget) {
						if (shouldResetScroll) continue;
					} else {
						const element = getElement(elementSelector);
						if (!element) continue;
						if (shouldResetScroll && scrollToTopSelectors) {
							scrollToTopElements ??= getScrollToTopElements(scrollToTopSelectors);
							if (scrollToTopElements.includes(element)) continue;
						}
					}
					if (!toElementEntries) toElementEntries = scrollRestorationCache[cacheKey] = {};
					toElementEntries[elementSelector] ??= fromElementEntries[elementSelector];
				}
			}
		}
		ignoreScroll = true;
		try {
			const hash = event.toLocation.hash;
			const hashScrollIntoViewOptions = event.toLocation.state.__hashScrollIntoViewOptions ?? true;
			let windowRestored = false;
			if (shouldResetScroll) {
				const action = locationHistoryActions.get(event.toLocation);
				const skipWindowRestore = hash && hashScrollIntoViewOptions && (action === "PUSH" || action === "REPLACE");
				const elementEntries = scroll.restoring ? scrollRestorationCache[cacheKey] : void 0;
				if (elementEntries) for (const elementSelector in elementEntries) {
					const { scrollX, scrollY } = elementEntries[elementSelector];
					if (elementSelector === windowScrollTarget) {
						if (skipWindowRestore) continue;
						scrollTo({
							top: scrollY,
							left: scrollX,
							behavior
						});
						windowRestored = true;
					} else {
						const element = getElement(elementSelector);
						if (element) {
							element.scrollLeft = scrollX;
							element.scrollTop = scrollY;
						}
					}
				}
				if (!windowRestored && !hash) {
					const scrollOptions = {
						top: 0,
						left: 0,
						behavior
					};
					scrollTo(scrollOptions);
					if (scrollToTopSelectors) {
						scrollToTopElements ??= getScrollToTopElements(scrollToTopSelectors);
						for (const element of scrollToTopElements) element.scrollTo(scrollOptions);
					}
				}
			}
			if (!windowRestored && hash && hashScrollIntoViewOptions) document.getElementById(hash)?.scrollIntoView(hashScrollIntoViewOptions);
		} finally {
			ignoreScroll = false;
		}
	});
}
//#endregion
export { defaultGetScrollRestorationKey, getElementScrollRestorationEntry, setupScrollRestoration, storageKey };

//# sourceMappingURL=scroll-restoration.js.map