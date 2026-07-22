import { UnauthorizedError } from "./errors.js";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { ApiConfig } from "./config.js";

/**
 * Authentication (JK-IAM-002). Two modes:
 *
 *  - OIDC (any environment where OIDC_ISSUER_URL is configured): verify a
 *    Bearer JWT against the issuer's JWKS, checking issuer and audience. The
 *    token subject (sub) becomes the platform user id.
 *
 *  - Local development fallback (APP_ENV=local AND no OIDC_ISSUER_URL): trust
 *    x-dev-user-id (a UUID) and optional x-dev-platform-admin. This is clearly
 *    logged as dev auth and is impossible outside local.
 */

export interface AuthenticatedPrincipal {
  userId: string;
  isPlatformAdmin: boolean;
  displayName?: string;
}

export interface Authenticator {
  authenticate(headers: Record<string, string | string[] | undefined>): Promise<AuthenticatedPrincipal>;
  readonly mode: "oidc" | "dev";
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class OidcAuthenticator implements Authenticator {
  readonly mode = "oidc" as const;
  private readonly jwks: JWTVerifyGetKey;

  constructor(
    private readonly issuer: string,
    private readonly audience: string | undefined,
  ) {
    this.jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, "")}/protocol/openid-connect/certs`));
  }

  async authenticate(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<AuthenticatedPrincipal> {
    const authorization = headerValue(headers, "authorization");
    if (!authorization?.toLowerCase().startsWith("bearer ")) {
      throw new UnauthorizedError("Missing bearer token");
    }
    const token = authorization.slice(7).trim();
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        ...(this.audience ? { audience: this.audience } : {}),
      });
      if (!payload.sub) {
        throw new UnauthorizedError("Token has no subject");
      }
      const roles = extractRoles(payload);
      return {
        userId: payload.sub,
        isPlatformAdmin: roles.includes("platform_admin"),
        displayName: typeof payload.name === "string" ? payload.name : undefined,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError("Invalid or expired token");
    }
  }
}

function extractRoles(payload: Record<string, unknown>): string[] {
  const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
  if (realmAccess && Array.isArray(realmAccess.roles)) {
    return realmAccess.roles.filter((r): r is string => typeof r === "string");
  }
  if (Array.isArray(payload.roles)) {
    return payload.roles.filter((r): r is string => typeof r === "string");
  }
  return [];
}

class DevAuthenticator implements Authenticator {
  readonly mode = "dev" as const;

  async authenticate(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<AuthenticatedPrincipal> {
    const userId = headerValue(headers, "x-dev-user-id");
    if (!userId || !UUID_RE.test(userId)) {
      throw new UnauthorizedError(
        "Local dev auth requires a valid x-dev-user-id (UUID) header",
      );
    }
    return {
      userId,
      isPlatformAdmin: headerValue(headers, "x-dev-platform-admin") === "true",
      displayName: headerValue(headers, "x-dev-display-name"),
    };
  }
}

export function createAuthenticator(config: ApiConfig): Authenticator {
  if (config.OIDC_ISSUER_URL) {
    return new OidcAuthenticator(config.OIDC_ISSUER_URL, config.OIDC_AUDIENCE);
  }
  if (config.APP_ENV !== "local") {
    throw new Error(
      "OIDC_ISSUER_URL is required outside local; refusing to start with dev auth",
    );
  }
  return new DevAuthenticator();
}
