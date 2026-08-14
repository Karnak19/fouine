import { JSONWebKeySet, JWTPayload, JWTVerifyOptions } from "jose";

//#region src/oauth2/verify.d.ts
type JwksFetchOptions = {
  /** Jwks url or promise of a Jwks */jwksFetch: string | (() => Promise<JSONWebKeySet | undefined>);
  /**
   * Stable object to cache the result of a function `jwksFetch` under,
   * with the same TTL and kid-miss refetch rules as string sources.
   * Without it, a function source is fetched on every verification.
   */
  jwksCacheKey?: object;
};
/**
 * @internal
 */
interface VerifyAccessTokenRemote {
  /** Full url of the introspect endpoint. Should end with `/oauth2/introspect` */
  introspectUrl: string;
  /** Client Secret */
  clientId: string;
  /** Client Secret */
  clientSecret: string;
  /**
   * Forces remote verification of a token.
   * This ensures attached session (if applicable)
   * is also still active.
   */
  force?: boolean;
  /**
   * Accept introspection responses that omit the `aud` claim even when a
   * required `audience` is configured in `verifyOptions`.
   *
   * By default verification fails closed: if you configure an `audience` and
   * the introspection response has no `aud` (or a mismatching one), the token
   * is rejected. Some authorization servers legitimately omit `aud` from
   * introspection responses (it is OPTIONAL per RFC 7662 §2.2); only enable
   * this if you trust the issuer to bind the token to this resource through
   * another mechanism, as it skips the audience check in that case.
   *
   * @default false
   */
  allowMissingAudience?: boolean;
}
/**
 * Performs local verification of an access token for your APIs.
 *
 * Can also be configured for remote verification.
 */
declare function verifyJwsAccessToken(token: string, opts: JwksFetchOptions & {
  /** Verify options */verifyOptions: JWTVerifyOptions & Required<Pick<JWTVerifyOptions, "audience" | "issuer">>;
}): Promise<JWTPayload>;
declare function getJwks(token: string, opts: JwksFetchOptions): Promise<JSONWebKeySet>;
/**
 * Performs local verification of an access token for your API.
 *
 * Can also be configured for remote verification.
 */
declare function verifyAccessToken(token: string, opts: {
  /** Verify options */verifyOptions: JWTVerifyOptions & Required<Pick<JWTVerifyOptions, "audience" | "issuer">>; /** Scopes to additionally verify. Token must include all but not exact. */
  scopes?: string[]; /** Required to verify access token locally */
  jwksUrl?: string; /** If provided, can verify a token remotely */
  remoteVerify?: VerifyAccessTokenRemote;
}): Promise<JWTPayload>;
//#endregion
export { getJwks, verifyAccessToken, verifyJwsAccessToken };