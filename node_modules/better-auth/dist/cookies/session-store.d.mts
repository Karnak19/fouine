import { GenericEndpointContext } from "@better-auth/core";
import { CookieOptions } from "better-call";
//#region src/cookies/session-store.d.ts
interface Cookie {
  name: string;
  value: string;
  attributes: CookieOptions;
}
declare const createSessionStore: (cookieName: string, cookieOptions: CookieOptions, ctx: GenericEndpointContext) => {
  chunk(value: string, options?: Partial<CookieOptions>): Cookie[];
  clean(): Cookie[];
  setCookies(cookies: Cookie[]): void;
};
declare function getChunkedCookie(ctx: GenericEndpointContext, cookieName: string): string | null;
declare function getAccountCookie(c: GenericEndpointContext): Promise<{
  id: string;
  createdAt: Date;
  updatedAt: Date;
  providerId: string;
  accountId: string;
  userId: string;
  accessToken?: string | null | undefined;
  refreshToken?: string | null | undefined;
  idToken?: string | null | undefined;
  accessTokenExpiresAt?: Date | null | undefined;
  refreshTokenExpiresAt?: Date | null | undefined;
  scope?: string | null | undefined;
  password?: string | null | undefined;
} | null>;
//#endregion
export { createSessionStore, getAccountCookie, getChunkedCookie };