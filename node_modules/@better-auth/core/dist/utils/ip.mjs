import { isDevelopment, isTest } from "../env/env-impl.mjs";
import * as z from "zod";
//#region src/utils/ip.ts
/**
* Checks if an IP is valid IPv4 or IPv6
*/
function isValidIP(ip) {
	return z.ipv4().safeParse(ip).success || z.ipv6().safeParse(ip).success;
}
/**
* Checks if an IP is IPv6
*/
function isIPv6(ip) {
	return z.ipv6().safeParse(ip).success;
}
/**
* Converts IPv4-mapped IPv6 address to IPv4
* e.g., "::ffff:192.0.2.1" -> "192.0.2.1"
*/
function extractIPv4FromMapped(ipv6) {
	const lower = ipv6.toLowerCase();
	if (lower.startsWith("::ffff:")) {
		const ipv4Part = lower.substring(7);
		if (z.ipv4().safeParse(ipv4Part).success) return ipv4Part;
	}
	const parts = ipv6.split(":");
	if (parts.length === 7 && parts[5]?.toLowerCase() === "ffff") {
		const ipv4Part = parts[6];
		if (ipv4Part && z.ipv4().safeParse(ipv4Part).success) return ipv4Part;
	}
	if (lower.includes("::ffff:") || lower.includes(":ffff:")) {
		const groups = expandIPv6(ipv6);
		if (groups.length === 8 && groups[0] === "0000" && groups[1] === "0000" && groups[2] === "0000" && groups[3] === "0000" && groups[4] === "0000" && groups[5] === "ffff" && groups[6] && groups[7]) return `${Number.parseInt(groups[6].substring(0, 2), 16)}.${Number.parseInt(groups[6].substring(2, 4), 16)}.${Number.parseInt(groups[7].substring(0, 2), 16)}.${Number.parseInt(groups[7].substring(2, 4), 16)}`;
	}
	return null;
}
/**
* Expands a compressed IPv6 address to full form
* e.g., "2001:db8::1" -> ["2001", "0db8", "0000", "0000", "0000", "0000", "0000", "0001"]
*/
function expandIPv6(ipv6) {
	if (ipv6.includes("::")) {
		const sides = ipv6.split("::");
		const left = sides[0] ? sides[0].split(":") : [];
		const right = sides[1] ? sides[1].split(":") : [];
		const missingGroups = 8 - left.length - right.length;
		const zeros = Array(missingGroups).fill("0000");
		const paddedLeft = left.map((g) => g.padStart(4, "0"));
		const paddedRight = right.map((g) => g.padStart(4, "0"));
		return [
			...paddedLeft,
			...zeros,
			...paddedRight
		];
	}
	return ipv6.split(":").map((g) => g.padStart(4, "0"));
}
/**
* Normalizes an IPv6 address to canonical form
* e.g., "2001:DB8::1" -> "2001:0db8:0000:0000:0000:0000:0000:0001"
*/
function normalizeIPv6(ipv6, subnetPrefix) {
	const groups = expandIPv6(ipv6);
	if (subnetPrefix !== void 0 && subnetPrefix < 128) {
		let bitsRemaining = Math.max(0, Math.floor(subnetPrefix));
		return groups.map((group) => {
			if (bitsRemaining <= 0) return "0000";
			if (bitsRemaining >= 16) {
				bitsRemaining -= 16;
				return group;
			}
			const masked = Number.parseInt(group, 16) & (65535 << 16 - bitsRemaining & 65535);
			bitsRemaining = 0;
			return masked.toString(16).padStart(4, "0");
		}).join(":").toLowerCase();
	}
	return groups.join(":").toLowerCase();
}
/**
* Normalizes an IP address (IPv4 or IPv6) for consistent rate limiting.
*
* @param ip - The IP address to normalize
* @param options - Normalization options
* @returns Normalized IP address
*
* @example
* normalizeIP("2001:DB8::1")
* // -> "2001:0db8:0000:0000:0000:0000:0000:0000"
*
* @example
* normalizeIP("::ffff:192.0.2.1")
* // -> "192.0.2.1" (converted to IPv4)
*
* @example
* normalizeIP("2001:db8::1", { ipv6Subnet: 64 })
* // -> "2001:0db8:0000:0000:0000:0000:0000:0000" (subnet /64)
*/
function normalizeIP(ip, options = {}) {
	if (z.ipv4().safeParse(ip).success) return ip.toLowerCase();
	if (!isIPv6(ip)) return ip.toLowerCase();
	const ipv4 = extractIPv4FromMapped(ip);
	if (ipv4) return ipv4.toLowerCase();
	return normalizeIPv6(ip, options.ipv6Subnet ?? 64);
}
/**
* Raw bytes of an IP for CIDR comparison. Returns `null` for an invalid IP.
*/
function ipToBytes(ip) {
	if (z.ipv4().safeParse(ip).success) return Uint8Array.from(ip.split(".").map((octet) => Number(octet)));
	if (!isIPv6(ip)) return null;
	const mapped = extractIPv4FromMapped(ip);
	if (mapped) return Uint8Array.from(mapped.split(".").map((octet) => Number(octet)));
	const groups = expandIPv6(ip);
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 8; i++) {
		const group = Number.parseInt(groups[i] ?? "0", 16);
		bytes[i * 2] = group >> 8 & 255;
		bytes[i * 2 + 1] = group & 255;
	}
	return bytes;
}
const CIDR_PREFIX_PATTERN = /^\d+$/;
/**
* Parses an IP or `IP/prefix` string into network bytes and a prefix length.
* The prefix must be digits only and within the address family. `null` if the
* value is not a valid IP or CIDR range, which keeps a malformed entry from
* silently behaving like a non-match.
*/
function parseCIDR(value) {
	const slash = value.lastIndexOf("/");
	const bytes = ipToBytes(slash === -1 ? value : value.slice(0, slash));
	if (!bytes) return null;
	const maxBits = bytes.length * 8;
	if (slash === -1) return {
		bytes,
		prefix: maxBits
	};
	const prefixPart = value.slice(slash + 1);
	if (!CIDR_PREFIX_PATTERN.test(prefixPart)) return null;
	const prefix = Number(prefixPart);
	return prefix <= maxBits ? {
		bytes,
		prefix
	} : null;
}
/**
* Whether `ipBytes` falls inside an already-parsed CIDR network.
*/
function matchesCIDR(ipBytes, net) {
	if (ipBytes.length !== net.bytes.length) return false;
	let bitsRemaining = net.prefix;
	for (let i = 0; i < ipBytes.length && bitsRemaining > 0; i++) {
		const take = bitsRemaining >= 8 ? 8 : bitsRemaining;
		const mask = take === 8 ? 255 : 255 << 8 - take & 255;
		if (((ipBytes[i] ?? 0) & mask) !== ((net.bytes[i] ?? 0) & mask)) return false;
		bitsRemaining -= 8;
	}
	return true;
}
/**
* Trusted-proxy entries that are not a valid IP address or CIDR range.
*/
function findInvalidTrustedProxies(entries) {
	return entries.filter((entry) => parseCIDR(entry) === null);
}
/**
* Resolves the client IP from a forwarded header. The leftmost token is spoofable,
* so with `trustedProxies` the chain is stripped from the right to the first
* untrusted hop. Otherwise only a single-value header is trusted. Returns `null`
* when no trustworthy client IP can be resolved.
*/
function getIPFromHeader(value, options = {}) {
	const forwardedIps = value.split(",").map((ip) => ip.trim()).filter(Boolean);
	if (forwardedIps.length === 0) return null;
	const trustedProxies = (options.trustedProxies ?? []).map(parseCIDR).filter((proxy) => {
		return proxy !== null;
	});
	if (trustedProxies.length > 0) {
		for (let i = forwardedIps.length - 1; i >= 0; i--) {
			const ip = forwardedIps[i];
			const ipBytes = ip ? ipToBytes(ip) : null;
			if (!ip || !ipBytes) return null;
			if (trustedProxies.some((proxy) => matchesCIDR(ipBytes, proxy))) continue;
			return normalizeIP(ip, { ipv6Subnet: options.ipv6Subnet });
		}
		return null;
	}
	if (forwardedIps.length !== 1) return null;
	const selectedIp = forwardedIps[0];
	if (!selectedIp || !isValidIP(selectedIp)) return null;
	return normalizeIP(selectedIp, { ipv6Subnet: options.ipv6Subnet });
}
const LOCALHOST_IP = "127.0.0.1";
const DEFAULT_IP_HEADERS = ["x-forwarded-for"];
/**
* Resolves the client IP for a request from the configured IP headers.
* Honors `disableIpTracking`, walks `ipAddressHeaders` in order (default
* `x-forwarded-for`), and falls back to localhost in development and test.
* Returns `null` when tracking is disabled or no trustworthy IP can be resolved.
*/
function getIp(req, options) {
	if (options.advanced?.ipAddress?.disableIpTracking) return null;
	const headers = "headers" in req ? req.headers : req;
	const ipHeaders = options.advanced?.ipAddress?.ipAddressHeaders || DEFAULT_IP_HEADERS;
	for (const key of ipHeaders) {
		const value = "get" in headers ? headers.get(key) : headers[key];
		if (typeof value === "string") {
			const ip = getIPFromHeader(value, {
				ipv6Subnet: options.advanced?.ipAddress?.ipv6Subnet,
				trustedProxies: options.advanced?.ipAddress?.trustedProxies
			});
			if (ip) return ip;
		}
	}
	if (isTest() || isDevelopment()) return LOCALHOST_IP;
	return null;
}
/**
* Creates a rate limit key from IP and path
* Uses a separator to prevent collision attacks
*
* @param ip - The IP address (should be normalized)
* @param path - The request path
* @returns Rate limit key
*/
function createRateLimitKey(ip, path) {
	return `${ip}|${path}`;
}
//#endregion
export { createRateLimitKey, findInvalidTrustedProxies, getIPFromHeader, getIp, isValidIP, normalizeIP };
