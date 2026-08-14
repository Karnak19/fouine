import { wildcardMatch } from "../../utils/wildcard.mjs";
import { safeJSONParse } from "@better-auth/core/utils/json";
import { createRateLimitKey, getIp } from "@better-auth/core/utils/ip";
import { normalizePathname } from "@better-auth/core/utils/url";
//#region src/api/rate-limiter/index.ts
const memory = /* @__PURE__ */ new Map();
const MEMORY_STORE_MAX_ENTRIES = 1e5;
function pruneMemoryStore() {
	const now = Date.now();
	for (const [key, entry] of memory) if (now >= entry.expiresAt) memory.delete(key);
	if (memory.size <= MEMORY_STORE_MAX_ENTRIES) return;
	const overflow = memory.size - MEMORY_STORE_MAX_ENTRIES;
	let removed = 0;
	for (const key of memory.keys()) {
		memory.delete(key);
		if (++removed >= overflow) break;
	}
}
/**
* Decide an atomic rate-limit step against an in-memory `RateLimit` snapshot
* for the rolling `window` (seconds) and `max`. Shared by the memory backend
* (read-decide-write is atomic under single-threaded JS) and as the fallback
* for storages lacking an atomic primitive.
*/
function decideConsume(data, rule, now) {
	const windowInMs = rule.window * 1e3;
	if (!data) return {
		next: {
			key: "",
			count: 1,
			lastRequest: now
		},
		update: false,
		allowed: true,
		retryAfter: null
	};
	if (now - data.lastRequest > windowInMs) return {
		next: {
			...data,
			count: 1,
			lastRequest: now
		},
		update: true,
		allowed: true,
		retryAfter: null
	};
	if (data.count >= rule.max) return {
		next: data,
		update: true,
		allowed: false,
		retryAfter: getRetryAfter(data.lastRequest, rule.window)
	};
	return {
		next: {
			...data,
			count: data.count + 1,
			lastRequest: now
		},
		update: true,
		allowed: true,
		retryAfter: null
	};
}
function rateLimitResponse(retryAfter) {
	return new Response(JSON.stringify({ message: "Too many requests. Please try again later." }), {
		status: 429,
		statusText: "Too Many Requests",
		headers: { "X-Retry-After": retryAfter.toString() }
	});
}
function getRetryAfter(lastRequest, window) {
	const now = Date.now();
	const windowInMs = window * 1e3;
	return Math.ceil((lastRequest + windowInMs - now) / 1e3);
}
function createDatabaseStorageWrapper(ctx) {
	const model = "rateLimit";
	const db = ctx.adapter;
	const readRow = async (key) => {
		const data = (await db.findMany({
			model,
			where: [{
				field: "key",
				value: key
			}]
		}))[0];
		if (typeof data?.lastRequest === "bigint") data.lastRequest = Number(data.lastRequest);
		return data;
	};
	const consume = async (key, rule) => {
		const windowInMs = rule.window * 1e3;
		const data = await readRow(key);
		const now = Date.now();
		if (!data) try {
			await db.create({
				model,
				data: {
					key,
					count: 1,
					lastRequest: now
				}
			});
			return {
				allowed: true,
				retryAfter: null
			};
		} catch (error) {
			if (!await readRow(key)) throw error;
			return consume(key, rule);
		}
		if (now - data.lastRequest > windowInMs) {
			if (await db.incrementOne({
				model,
				where: [{
					field: "key",
					value: key
				}, {
					field: "lastRequest",
					operator: "lte",
					value: data.lastRequest
				}],
				increment: {},
				set: {
					count: 1,
					lastRequest: now
				}
			})) {
				deleteExpiredRows(now);
				return {
					allowed: true,
					retryAfter: null
				};
			}
			return consume(key, rule);
		}
		const windowStart = now - windowInMs;
		if (await db.incrementOne({
			model,
			where: [
				{
					field: "key",
					value: key
				},
				{
					field: "lastRequest",
					operator: "gt",
					value: windowStart
				},
				{
					field: "count",
					operator: "lt",
					value: rule.max
				}
			],
			increment: { count: 1 },
			set: { lastRequest: now }
		})) return {
			allowed: true,
			retryAfter: null
		};
		const fresh = await readRow(key);
		if (!fresh) return consume(key, rule);
		if (now - fresh.lastRequest > windowInMs) return consume(key, rule);
		return {
			allowed: false,
			retryAfter: getRetryAfter(fresh.lastRequest, rule.window)
		};
	};
	const deleteExpiredRows = (now) => {
		const cutoff = now - Math.max(ctx.rateLimit.window, ...getDefaultSpecialRules().map((r) => r.window)) * 1e3;
		ctx.runInBackground(db.deleteMany({
			model,
			where: [{
				field: "lastRequest",
				operator: "lt",
				value: cutoff
			}]
		}).then(() => void 0).catch((e) => ctx.logger.error("Error pruning rate limit rows", e)));
	};
	return {
		get: readRow,
		set: async (key, value, _update) => {
			try {
				if (_update) await db.updateMany({
					model,
					where: [{
						field: "key",
						value: key
					}],
					update: {
						count: value.count,
						lastRequest: value.lastRequest
					}
				});
				else await db.create({
					model,
					data: {
						key,
						count: value.count,
						lastRequest: value.lastRequest
					}
				});
			} catch (e) {
				ctx.logger.error("Error setting rate limit", e);
			}
		},
		consume
	};
}
function getRateLimitStorage(ctx, rateLimitSettings) {
	if (ctx.options.rateLimit?.customStorage) return ctx.options.rateLimit.customStorage;
	const storage = ctx.rateLimit.storage;
	if (storage === "secondary-storage") {
		const ttlFor = (window) => window ?? ctx.options.rateLimit?.window ?? 10;
		return {
			get: async (key) => {
				const data = await ctx.options.secondaryStorage?.get(key);
				return data ? safeJSONParse(data) : null;
			},
			set: async (key, value, _update) => {
				await ctx.options.secondaryStorage?.set?.(key, JSON.stringify(value), ttlFor(rateLimitSettings.window));
			},
			consume: ctx.options.secondaryStorage?.increment ? async (key, rule) => {
				if (await ctx.options.secondaryStorage.increment(key, ttlFor(rule.window)) <= rule.max) return {
					allowed: true,
					retryAfter: null
				};
				return {
					allowed: false,
					retryAfter: rule.window
				};
			} : void 0
		};
	} else if (storage === "memory") {
		const ttlFor = (window) => window ?? ctx.options.rateLimit?.window ?? 10;
		return {
			async get(key) {
				const entry = memory.get(key);
				if (!entry) return null;
				if (Date.now() >= entry.expiresAt) {
					memory.delete(key);
					return null;
				}
				return entry.data;
			},
			async set(key, value, _update) {
				const expiresAt = Date.now() + ttlFor(rateLimitSettings.window) * 1e3;
				memory.set(key, {
					data: value,
					expiresAt
				});
			},
			async consume(key, rule) {
				pruneMemoryStore();
				const now = Date.now();
				const entry = memory.get(key);
				const decision = decideConsume(entry && now < entry.expiresAt ? entry.data : void 0, rule, now);
				if (decision.allowed) memory.set(key, {
					data: {
						...decision.next,
						key
					},
					expiresAt: now + ttlFor(rule.window) * 1e3
				});
				return {
					allowed: decision.allowed,
					retryAfter: decision.retryAfter
				};
			}
		};
	}
	return createDatabaseStorageWrapper(ctx);
}
let ipWarningLogged = false;
const NO_TRUSTED_IP_KEY = "no-trusted-ip";
async function resolveRateLimitConfig(req, ctx) {
	const basePath = new URL(ctx.baseURL).pathname;
	const path = normalizePathname(req.url, basePath);
	let currentWindow = ctx.rateLimit.window;
	let currentMax = ctx.rateLimit.max;
	const ip = getIp(req, ctx.options);
	if (!ip && ctx.options.advanced?.ipAddress?.disableIpTracking) return null;
	if (!ip && !ipWarningLogged) {
		ctx.logger.warn("Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket. Ensure your runtime forwards a trusted client IP header, then set `advanced.ipAddress.ipAddressHeaders` or `advanced.ipAddress.trustedProxies` so the address can be resolved.");
		ipWarningLogged = true;
	}
	const key = createRateLimitKey(ip ?? NO_TRUSTED_IP_KEY, path);
	const specialRule = getDefaultSpecialRules().find((rule) => rule.pathMatcher(path));
	if (specialRule) {
		currentWindow = specialRule.window;
		currentMax = specialRule.max;
	}
	for (const plugin of ctx.options.plugins || []) if (plugin.rateLimit) {
		const matchedRule = plugin.rateLimit.find((rule) => rule.pathMatcher(path));
		if (matchedRule) {
			currentWindow = matchedRule.window;
			currentMax = matchedRule.max;
			break;
		}
	}
	if (ctx.rateLimit.customRules) {
		const _path = Object.keys(ctx.rateLimit.customRules).find((p) => {
			if (p.includes("*")) return wildcardMatch(p)(path);
			return p === path;
		});
		if (_path) {
			const customRule = ctx.rateLimit.customRules[_path];
			const resolved = typeof customRule === "function" ? await customRule(req, {
				window: currentWindow,
				max: currentMax
			}) : customRule;
			if (resolved) {
				currentWindow = resolved.window;
				currentMax = resolved.max;
			}
			if (resolved === false) return null;
		}
	}
	return {
		key,
		currentWindow,
		currentMax
	};
}
let legacyFallbackWarningLogged = false;
/**
* Decides the rate limit for the request in a single atomic step. The whole
* check-and-increment happens here in the request phase; there is no separate
* response-phase write-back, so concurrent requests cannot all pass a stale
* read before any increment lands.
*/
async function onRequestRateLimit(req, ctx) {
	if (!ctx.rateLimit.enabled) return;
	const config = await resolveRateLimitConfig(req, ctx);
	if (!config) return;
	const { key, currentWindow, currentMax } = config;
	const storage = getRateLimitStorage(ctx, { window: currentWindow });
	const rule = {
		window: currentWindow,
		max: currentMax
	};
	if (storage.consume) {
		const { allowed, retryAfter } = await storage.consume(key, rule);
		if (!allowed) return rateLimitResponse(retryAfter ?? currentWindow);
		return;
	}
	return legacyConsume(ctx, storage, key, rule);
}
/**
* Non-atomic check-then-increment for storages that do not implement `consume`
* (custom storages, or secondary storages without `increment`). Under
* concurrency this is best-effort: simultaneous requests can each pass the
* check before either write lands.
*
* FIXME(rate-limit-consume-required): remove on `next` once `consume` is the
* sole required member of the storage contract.
*/
async function legacyConsume(ctx, storage, key, rule) {
	if (!legacyFallbackWarningLogged) {
		ctx.logger.warn("Rate limiting is best-effort: the configured storage has no atomic `consume`, so concurrent requests may bypass the limit. Provide a storage that implements `consume` for strict enforcement.");
		legacyFallbackWarningLogged = true;
	}
	const decision = decideConsume(await storage.get(key), rule, Date.now());
	if (!decision.allowed) return rateLimitResponse(decision.retryAfter ?? rule.window);
	await storage.set(key, {
		...decision.next,
		key
	}, decision.update);
}
function getDefaultSpecialRules() {
	return [{
		pathMatcher(path) {
			return path.startsWith("/sign-in") || path.startsWith("/sign-up") || path.startsWith("/change-password") || path.startsWith("/change-email");
		},
		window: 10,
		max: 3
	}, {
		pathMatcher(path) {
			return path === "/request-password-reset" || path === "/send-verification-email" || path.startsWith("/forget-password") || path === "/email-otp/send-verification-otp" || path === "/email-otp/request-password-reset";
		},
		window: 60,
		max: 3
	}];
}
//#endregion
export { onRequestRateLimit };
