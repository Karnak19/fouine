import { Session, User } from "../types/models.mjs";
import { Auth } from "../types/auth.mjs";
import { AuthClient } from "../client/vanilla.mjs";
import { setCookieToHeader } from "../cookies/cookie-utils.mjs";
import { Awaitable, BetterAuthClientOptions, BetterAuthOptions } from "@better-auth/core";
import * as _better_auth_core_db_adapter0 from "@better-auth/core/db/adapter";
import { SuccessContext } from "@better-fetch/fetch";

//#region src/test-utils/test-instance.d.ts
declare function getTestInstance<O extends Partial<BetterAuthOptions>, C extends BetterAuthClientOptions>(options?: O | undefined, config?: {
  clientOptions?: C;
  port?: number;
  disableTestUser?: boolean;
  testUser?: Partial<User>;
  testWith?: "sqlite" | "postgres" | "mongodb" | "mysql";
} | undefined): Promise<{
  auth: Auth<O>;
  client: AuthClient<(C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  }>;
  testUser: {
    id?: string | undefined;
    createdAt?: Date | undefined;
    updatedAt?: Date | undefined;
    email: string;
    emailVerified?: boolean | undefined;
    name: string;
    image?: string | null | undefined;
    password: string;
  };
  signInWithTestUser: () => Promise<{
    session: Session;
    user: User;
    headers: Headers;
    setCookie: (name: string, value: string) => void;
    runWithUser: (fn: (headers: Headers) => Promise<void>) => Promise<void>;
  }>;
  signInWithUser: (email: string, password: string) => Promise<{
    res: {
      user: User;
      session: Session;
    };
    headers: Headers;
  }>;
  cookieSetter: typeof setCookieToHeader;
  customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
  sessionSetter: (headers: Headers) => (context: SuccessContext) => void;
  db: _better_auth_core_db_adapter0.DBAdapter<BetterAuthOptions>;
  runWithUser: (email: string, password: string, fn: (headers: Headers) => Awaitable<void>) => Promise<void>;
}>;
//#endregion
export { getTestInstance };