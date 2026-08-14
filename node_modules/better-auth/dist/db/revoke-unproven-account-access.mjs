//#region src/db/revoke-unproven-account-access.ts
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
async function revokeUnprovenAccountAccess(ctx, userId) {
	const user = await ctx.context.internalAdapter.findUserById(userId);
	if (!user || user.emailVerified) return;
	const accounts = await ctx.context.internalAdapter.findAccounts(userId);
	for (const account of accounts) if (account.providerId === "credential") await ctx.context.internalAdapter.deleteAccount(account.id);
	await ctx.context.internalAdapter.deleteUserSessions(userId);
}
//#endregion
export { revokeUnprovenAccountAccess };
