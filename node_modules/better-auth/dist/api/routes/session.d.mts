import { Prettify as Prettify$1 } from "../../types/helper.mjs";
import { Session as Session$1, User as User$1 } from "../../types/models.mjs";
import { BetterAuthOptions, GenericEndpointContext } from "@better-auth/core";
import * as _better_auth_core_db0 from "@better-auth/core/db";
import * as better_call0 from "better-call";
import * as z from "zod";

//#region src/api/routes/session.d.ts
declare const getSession: <Option extends BetterAuthOptions>() => better_call0.StrictEndpoint<"/get-session", {
  method: ("GET" | "POST")[];
  operationId: string;
  query: z.ZodOptional<z.ZodObject<{
    disableCookieCache: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    disableRefresh: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
  }, z.core.$strip>>;
  requireHeaders: true;
  metadata: {
    openapi: {
      operationId: string;
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "object";
                properties: {
                  session: {
                    $ref: string;
                  };
                  user: {
                    $ref: string;
                  };
                };
                required: string[];
              };
            };
          };
        };
      };
    };
  };
}, {
  session: Session$1<Option["session"], Option["plugins"]>;
  user: User$1<Option["user"], Option["plugins"]>;
} | null>;
/**
 * Whether the deployment keeps sessions in a durable server-side store
 * (a database or secondary storage) rather than only in the signed cookie.
 *
 * Sensitive operations use this to decide whether the cookie cache is merely an
 * optimization that must be bypassed for an authoritative read (`true`), or the
 * only place the session lives and therefore the authority itself (`false`, for
 * stateless / DB-less deployments). Pass the result as `disableCookieCache` so a
 * revoked-but-cached session cannot authorize a sensitive action.
 */
declare const isStateful: (ctx: GenericEndpointContext) => boolean;
declare const getSessionFromCtx: <U extends Record<string, any> = Record<string, any>, S extends Record<string, any> = Record<string, any>>(ctx: GenericEndpointContext, config?: {
  disableCookieCache?: boolean;
  disableRefresh?: boolean;
} | undefined) => Promise<{
  session: S & Session$1;
  user: U & User$1;
} | null>;
/**
 * Reads the session from the source that can authorize sensitive work.
 *
 * Stateful deployments must re-read the server-side session store because an
 * earlier hook may have populated `ctx.context.session` from cookie cache.
 * Stateless deployments keep the signed cookie as the session record.
 */
declare const getAuthoritativeSessionFromCtx: <U extends Record<string, any> = Record<string, any>, S extends Record<string, any> = Record<string, any>>(ctx: GenericEndpointContext) => Promise<{
  session: S & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    expiresAt: Date;
    token: string;
    ipAddress?: string | null | undefined;
    userAgent?: string | null | undefined;
  };
  user: U & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    email: string;
    emailVerified: boolean;
    name: string;
    image?: string | null | undefined;
  };
} | null>;
/**
 * The middleware forces the endpoint to require a valid session.
 */
declare const sessionMiddleware: (inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
  session: {
    session: Record<string, any> & {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
    };
    user: Record<string, any> & {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      email: string;
      emailVerified: boolean;
      name: string;
      image?: string | null | undefined;
    };
  };
}>;
/**
 * This middleware forces the endpoint to require a valid authoritative session.
 * This should be used for sensitive operations like password changes, account deletion, etc.
 */
declare const sensitiveSessionMiddleware: (inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
  session: {
    session: Record<string, any> & {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
    };
    user: Record<string, any> & {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      email: string;
      emailVerified: boolean;
      name: string;
      image?: string | null | undefined;
    };
  };
}>;
/**
 * This middleware allows you to call the endpoint on the client if session is valid.
 * However, if called on the server, no session is required.
 */
declare const requestOnlySessionMiddleware: (inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
  session: {
    session: Record<string, any> & {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
    };
    user: Record<string, any> & {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      email: string;
      emailVerified: boolean;
      name: string;
      image?: string | null | undefined;
    };
  } | null;
}>;
/**
 * This middleware forces the endpoint to require a valid session,
 * as well as making sure the session is fresh before proceeding.
 *
 * Session freshness check will be skipped if the session config's freshAge
 * is set to 0
 */
declare const freshSessionMiddleware: (inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
  session: {
    session: Record<string, any> & {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
    };
    user: Record<string, any> & {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      email: string;
      emailVerified: boolean;
      name: string;
      image?: string | null | undefined;
    };
  };
}>;
/**
 * user active sessions list
 */
declare const listSessions: <Option extends BetterAuthOptions>() => better_call0.StrictEndpoint<"/list-sessions", {
  method: "GET";
  operationId: string;
  use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    session: {
      session: Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      };
      user: Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    };
  }>)[];
  requireHeaders: true;
  metadata: {
    openapi: {
      operationId: string;
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "array";
                items: {
                  $ref: string;
                };
              };
            };
          };
        };
      };
    };
  };
}, Prettify$1<{
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  expiresAt: Date;
  token: string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
} & _better_auth_core_db0.InferDBFieldsFromOptions<Option["session"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"session", Option["plugins"]> extends infer T ? { [K in keyof T]: T[K] } : never>[]>;
/**
 * revoke a single session
 */
declare const revokeSession: better_call0.StrictEndpoint<"/revoke-session", {
  method: "POST";
  body: z.ZodObject<{
    token: z.ZodString;
  }, z.core.$strip>;
  use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    session: {
      session: Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      };
      user: Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    };
  }>)[];
  requireHeaders: true;
  metadata: {
    openapi: {
      description: string;
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object";
              properties: {
                token: {
                  type: string;
                  description: string;
                };
              };
              required: string[];
            };
          };
        };
      };
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "object";
                properties: {
                  status: {
                    type: string;
                    description: string;
                  };
                };
                required: string[];
              };
            };
          };
        };
      };
    };
  };
}, {
  status: boolean;
}>;
/**
 * revoke all user sessions
 */
declare const revokeSessions: better_call0.StrictEndpoint<"/revoke-sessions", {
  method: "POST";
  use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    session: {
      session: Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      };
      user: Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    };
  }>)[];
  requireHeaders: true;
  metadata: {
    openapi: {
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "object";
                properties: {
                  status: {
                    type: string;
                    description: string;
                  };
                };
                required: string[];
              };
            };
          };
        };
      };
    };
  };
}, {
  status: boolean;
}>;
declare const revokeOtherSessions: better_call0.StrictEndpoint<"/revoke-other-sessions", {
  method: "POST";
  requireHeaders: true;
  use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    session: {
      session: Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      };
      user: Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    };
  }>)[];
  metadata: {
    openapi: {
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "object";
                properties: {
                  status: {
                    type: string;
                    description: string;
                  };
                };
                required: string[];
              };
            };
          };
        };
      };
    };
  };
}, {
  status: boolean;
}>;
//#endregion
export { freshSessionMiddleware, getAuthoritativeSessionFromCtx, getSession, getSessionFromCtx, isStateful, listSessions, requestOnlySessionMiddleware, revokeOtherSessions, revokeSession, revokeSessions, sensitiveSessionMiddleware, sessionMiddleware };