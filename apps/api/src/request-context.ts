import { createTenantContext, type TenantContext } from "@jk/domain-kernel";
import { MissingHeaderError } from "./errors.js";
import type { AuthenticatedPrincipal } from "./auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build a TenantContext for a request (§46): the tenant is taken from the
 * x-tenant-id header and the actor is the authenticated principal. A client
 * cannot act as another user — the actor id always comes from the verified
 * token/dev identity, never from the body. Membership in the selected tenant
 * is enforced downstream by the application authorization policy, so a client
 * that names a tenant it does not belong to is denied (403), never served.
 */
export function buildTenantContext(
  principal: AuthenticatedPrincipal,
  tenantIdHeader: string | undefined,
  correlationId: string,
): TenantContext {
  if (!tenantIdHeader || !UUID_RE.test(tenantIdHeader)) {
    throw new MissingHeaderError("A valid x-tenant-id header is required for this operation");
  }
  return createTenantContext({
    tenantId: tenantIdHeader,
    actor: {
      type: "user",
      id: principal.userId,
      display: principal.displayName,
    },
    correlationId,
  });
}
