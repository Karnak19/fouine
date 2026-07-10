import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { config } from "~/config";
import { db } from "~/db";

// Allowlist gate: a GitHub login is allowed only if present in `allowed`
// (which config already lowercased). Empty/missing login → rejected.
export function isAllowedUser(githubUsername: string | undefined, allowed: string[]): boolean {
  const login = String(githubUsername ?? "").toLowerCase();
  return !!login && allowed.includes(login);
}

// GitHub OAuth login, sharing the app's bun:sqlite DB. Gated by an allowlist of
// GitHub logins so the (open-source, self-hosted) instance stays limited to
// friends/colleagues — anyone not listed is rejected at account creation.
export const auth = betterAuth({
  database: db,
  secret: config.auth.secret,
  baseURL: config.auth.url,
  trustedOrigins: [config.auth.url],
  user: {
    additionalFields: {
      githubUsername: { type: "string", required: false, input: false },
    },
  },
  socialProviders: {
    github: {
      clientId: config.auth.githubClientId as string,
      clientSecret: config.auth.githubClientSecret as string,
      mapProfileToUser: (profile) => ({
        githubUsername: String(profile.login ?? ""),
        name: profile.name ?? profile.login,
        image: profile.avatar_url,
      }),
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const login = (user as { githubUsername?: string }).githubUsername;
          if (!isAllowedUser(login, config.auth.allowedUsers)) {
            throw new APIError("FORBIDDEN", {
              message: "This GitHub account is not allowed to access fouine.",
            });
          }
          return { data: user };
        },
      },
    },
  },
});

// Create better-auth's tables (user/session/account/verification) at boot,
// matching the app's no-migration-framework, create-at-boot convention in db.ts.
export async function migrateAuth(): Promise<void> {
  if (!config.auth.enabled) return;
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
