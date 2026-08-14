import { BetterAuthOptions } from "../types/init-options.mjs";
//#region src/utils/ip.d.ts
/**
 * Normalizes an IP address for consistent rate limiting.
 *
 * Features:
 * - Normalizes IPv6 to canonical lowercase form
 * - Converts IPv4-mapped IPv6 to IPv4
 * - Supports IPv6 subnet extraction
 * - Handles all edge cases (::1, ::, etc.)
 */
interface NormalizeIPOptions {
  /**
   * Prefix length used to collapse IPv6 addresses before keying.
   * Any integer from 0 to 128 is accepted. Common values: 32, 48, 56, 64, 128.
   * Values outside 0-128 are clamped.
   *
   * @default 64
   */
  ipv6Subnet?: number;
}
/**
 * Checks if an IP is valid IPv4 or IPv6
 */
declare function isValidIP(ip: string): boolean;
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
declare function normalizeIP(ip: string, options?: NormalizeIPOptions): string;
/**
 * Trusted-proxy entries that are not a valid IP address or CIDR range.
 */
declare function findInvalidTrustedProxies(entries: string[]): string[];
/**
 * Resolves the client IP from a forwarded header. The leftmost token is spoofable,
 * so with `trustedProxies` the chain is stripped from the right to the first
 * untrusted hop. Otherwise only a single-value header is trusted. Returns `null`
 * when no trustworthy client IP can be resolved.
 */
declare function getIPFromHeader(value: string, options?: {
  ipv6Subnet?: number;
  trustedProxies?: string[];
}): string | null;
/**
 * Resolves the client IP for a request from the configured IP headers.
 * Honors `disableIpTracking`, walks `ipAddressHeaders` in order (default
 * `x-forwarded-for`), and falls back to localhost in development and test.
 * Returns `null` when tracking is disabled or no trustworthy IP can be resolved.
 */
declare function getIp(req: Request | Headers, options: BetterAuthOptions): string | null;
/**
 * Creates a rate limit key from IP and path
 * Uses a separator to prevent collision attacks
 *
 * @param ip - The IP address (should be normalized)
 * @param path - The request path
 * @returns Rate limit key
 */
declare function createRateLimitKey(ip: string, path: string): string;
//#endregion
export { createRateLimitKey, findInvalidTrustedProxies, getIPFromHeader, getIp, isValidIP, normalizeIP };