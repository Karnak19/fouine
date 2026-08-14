import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
import { JWTPayload } from "jose";

//#region src/social-providers/google.d.ts
interface GoogleProfile {
  aud: string;
  azp: string;
  email: string;
  email_verified: boolean;
  exp: number;
  /**
   * The family name of the user, or last name in most
   * Western languages.
   */
  family_name: string;
  /**
   * The given name of the user, or first name in most
   * Western languages.
   */
  given_name: string;
  hd?: string | undefined;
  iat: number;
  iss: string;
  jti?: string | undefined;
  locale?: string | undefined;
  name: string;
  nbf?: number | undefined;
  picture: string;
  sub: string;
}
interface GoogleOptions extends ProviderOptions<GoogleProfile> {
  clientId: string | string[];
  /**
   * The access type to use for the authorization code request
   */
  accessType?: ("offline" | "online") | undefined;
  /**
   * The display mode to use for the authorization code request
   */
  display?: ("page" | "popup" | "touch" | "wap") | undefined;
  /**
   * The hosted domain (Google Workspace) the user must belong to.
   *
   * This is sent to Google as the `hd` authorization hint and, when set, is
   * also enforced against the `hd` claim of the returned id token/profile.
   * Set `hd: "*"` to require any Workspace hosted-domain claim. Sign-in is
   * rejected when the claim is missing or does not satisfy this restriction.
   */
  hd?: string | undefined;
}
interface VerifyGoogleIdTokenOptions {
  token: string;
  audience: string | string[];
  nonce?: string | undefined;
}
/**
 * Verifies a Google ID token against Google's issuer, audience, signature,
 * expiry, and maximum token age.
 */
declare const verifyGoogleIdToken: ({
  token,
  audience,
  nonce
}: VerifyGoogleIdTokenOptions) => Promise<JWTPayload | null>;
/**
 * Checks whether Google's verified `hd` claim satisfies the configured hosted
 * domain restriction. `hd: "*"` accepts any Google Workspace hosted domain.
 */
declare const isGoogleHostedDomainAllowed: (configuredHostedDomain: string | undefined, tokenHostedDomain: unknown) => boolean;
declare const google: (options: GoogleOptions) => {
  id: "google";
  name: string;
  createAuthorizationURL({
    state,
    scopes,
    codeVerifier,
    redirectURI,
    loginHint,
    display
  }: {
    state: string;
    codeVerifier: string;
    scopes?: string[] | undefined;
    redirectURI: string;
    display?: string | undefined;
    loginHint?: string | undefined;
  }): Promise<URL>;
  validateAuthorizationCode: ({
    code,
    codeVerifier,
    redirectURI
  }: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }) => Promise<OAuth2Tokens>;
  refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>;
  verifyIdToken(token: string, nonce: string | undefined): Promise<boolean>;
  getUserInfo(token: OAuth2Tokens & {
    user?: {
      name?: {
        firstName?: string;
        lastName?: string;
      };
      email?: string;
    } | undefined;
  }): Promise<{
    user: {
      id: string;
      name?: string;
      email?: string | null;
      image?: string;
      emailVerified: boolean;
      [key: string]: any;
    };
    data: any;
  } | null>;
  options: GoogleOptions;
};
declare const getGooglePublicKey: (kid: string) => Promise<Uint8Array<ArrayBufferLike> | CryptoKey>;
//#endregion
export { GoogleOptions, GoogleProfile, VerifyGoogleIdTokenOptions, getGooglePublicKey, google, isGoogleHostedDomainAllowed, verifyGoogleIdToken };