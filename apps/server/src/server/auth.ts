import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { mcp } from "better-auth/plugins";
import { config } from "~/config";
import { db } from "~/db";
import { log } from "~/server/log";

// Allowlist gate: a GitHub login is allowed only if present in `allowed`
// (which config already lowercased). Empty/missing login → rejected.
export function isAllowedUser(githubUsername: string | undefined, allowed: string[]): boolean {
  const login = String(githubUsername ?? "").toLowerCase();
  return !!login && allowed.includes(login);
}

// GitHub OAuth login, sharing the app's bun:sqlite DB. Gated by an allowlist of
// GitHub logins so the (open-source, self-hosted) instance stays limited to
// friends/colleagues — anyone not listed is rejected at account creation.
//
// Only constructed when login is enabled: betterAuth() validates the secret at
// module load and throws in production (NODE_ENV=production) if it's unset, so a
// disabled-auth prod boot must not build it. Every call-site guards on
// config.auth.enabled, so `null` is never dereferenced.
//
// The options live in a function so `auth` keeps the instance type the plugins
// add to `auth.api` (`getMcpSession`, `getMCPProtectedResource`, …); a bare
// `ReturnType<typeof betterAuth>` widens to the plugin-less options and loses
// them, which `withMcpAuth` needs.
function createAuth() {
  return betterAuth({
    database: db,
    secret: config.auth.secret,
    baseURL: config.auth.url,
    trustedOrigins: [config.auth.url],
    user: {
      additionalFields: {
        // No `input: false` here: better-auth strips input:false fields when
        // mapping a provider profile (parseAdditionalUserInputFromProviderProfile),
        // so githubUsername would never reach the allowlist hook below.
        githubUsername: { type: "string", required: false },
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
    plugins: [
      // OAuth 2.1 provider for MCP clients (Claude Code, OpenCode, …). Adds
      // discovery metadata, dynamic client registration and the code/token
      // endpoints under /api/auth/*, plus `getMcpSession`, which
      // `~/mastra/mcp-http.ts` uses (via withMcpAuth) to accept a Bearer token
      // on /api/mcp. `loginPage` is where an unauthenticated authorize request
      // lands — the SPA root renders the login screen there.
      mcp({ loginPage: "/", resource: `${config.auth.url}/api/mcp` }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const login = (user as { githubUsername?: string }).githubUsername;
            if (!isAllowedUser(login, config.auth.allowedUsers)) {
              log.warn("login rejected", {
                login: login ?? null,
                allowed: config.auth.allowedUsers.length,
              });
              throw new APIError("FORBIDDEN", {
                message: "This GitHub account is not allowed to access fouine.",
              });
            }
            return { data: user };
          },
        },
      },
    },
  })
}

type Auth = ReturnType<typeof createAuth>;

export const auth: Auth = config.auth.enabled
  ? createAuth()
  : (null as unknown as Auth);

// Create better-auth's tables (user/session/account/verification) at boot,
// matching the app's no-migration-framework, create-at-boot convention in db.ts.
export async function migrateAuth(): Promise<void> {
  if (!config.auth.enabled) return;
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
