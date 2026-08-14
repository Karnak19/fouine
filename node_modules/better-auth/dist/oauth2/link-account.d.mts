import { Account, User } from "../types/models.mjs";
import { GenericEndpointContext } from "@better-auth/core";

//#region src/oauth2/link-account.d.ts
declare function handleOAuthUserInfo(c: GenericEndpointContext, opts: {
  userInfo: Omit<User, "createdAt" | "updatedAt">;
  account: Omit<Account, "id" | "userId" | "createdAt" | "updatedAt">;
  callbackURL?: string | undefined;
  disableSignUp?: boolean | undefined;
  overrideUserInfo?: boolean | undefined;
  isTrustedProvider?: boolean | undefined;
  /**
   * Whether `account.providerId` may be matched against the globally
   * configured `accountLinking.trustedProviders` list to infer trust.
   *
   * Defaults to `true` for built-in social/OAuth providers, whose
   * `providerId` namespace is controlled by the developer's config. Callers
   * whose `providerId` is user-controlled (e.g. the SSO plugin, where any
   * authenticated user can register a provider with an arbitrary id) must
   * pass `false` so a provider named after a trusted social provider can't
   * launder that trust. Such callers should supply their own
   * `isTrustedProvider` signal instead.
   */
  trustProviderByName?: boolean | undefined;
}): Promise<{
  error: string;
  data: null;
  isRegister?: undefined;
} | {
  error: string;
  data: null;
  isRegister: boolean;
} | {
  data: {
    session: {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
    };
    user: {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      email: string;
      emailVerified: boolean;
      name: string;
      image?: string | null | undefined;
    };
  };
  error: null;
  isRegister: boolean;
}>;
/**
 * Provider profile a freshly linked account may copy onto the local user.
 * `id` is the provider's account id (never the local user id), and `email`/
 * `emailVerified` are identity anchors; all three are stripped before the
 * remaining fields are written.
 */
type LinkedProviderProfile = {
  id: string | number;
  name?: string | undefined;
  email?: string | null | undefined;
  emailVerified?: boolean | undefined;
  image?: string | null | undefined;
};
/**
 * Apply the `account.accountLinking.updateUserInfoOnLink` policy: when enabled,
 * copy the freshly linked provider's profile onto the local user, matching the
 * field set persisted on sign-up. The local `email` and `emailVerified` are
 * never changed, so a link can't rebind the account's identity, and
 * `updateUser` drops `undefined` fields, so a provider that omits one leaves
 * the existing column intact.
 *
 * Returns the updated user so a caller that issues a session can seed the
 * cookie cache with the fresh row. Returns `undefined` when the policy is
 * disabled or the update fails: a failed profile sync must not abort the link.
 */
declare function applyUpdateUserInfoOnLink(c: GenericEndpointContext, userId: string, userInfo: LinkedProviderProfile): Promise<User | undefined>;
//#endregion
export { applyUpdateUserInfoOnLink, handleOAuthUserInfo };