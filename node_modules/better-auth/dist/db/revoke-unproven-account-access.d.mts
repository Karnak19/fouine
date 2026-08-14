import { GenericEndpointContext } from "@better-auth/core";

//#region src/db/revoke-unproven-account-access.d.ts
/**
 * Strip every credential and session a pre-existing account accrued before
 * control of its email was proven.
 *
 * An `emailVerified: false` row carries no proof that the password on it belongs
 * to the mailbox owner. When an email-primary proof (magic link, email OTP)
 * resolves to such a row, deleting the `credential` account and revoking standing
 * sessions makes the verified owner inherit no password or session that predates
 * the proof. Call this before flipping `emailVerified` and minting the owner's
 * session; it no-ops if a concurrent flow has already verified the account.
 *
 * @param userId - The pre-existing, not-yet-verified user being promoted.
 */
declare function revokeUnprovenAccountAccess(ctx: GenericEndpointContext, userId: string): Promise<void>;
//#endregion
export { revokeUnprovenAccountAccess };