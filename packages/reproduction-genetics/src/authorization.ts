import { type TenantContext } from "@jk/domain-kernel";
import type pg from "pg";

/**
 * Authorization for Reproduction and Genetics (§66). Herd/clinical roles record
 * services, checks, and calvings; any active member reads. High-impact genetic
 * actions (mating approval, culling) remain human-approved in later slices.
 */
export type ReproAction = "record_reproduction" | "read";

const WRITE_ROLES = new Set([
  "tenant_owner",
  "farm_manager",
  "technician",
  "veterinarian",
]);

export interface CallerMembership {
  role: string;
  status: string;
}

export interface ReproAuthorizationDecision {
  allowed: boolean;
  reason: string;
  action: ReproAction;
}

export async function loadCallerMemberships(
  client: pg.PoolClient,
  context: TenantContext,
): Promise<CallerMembership[]> {
  if (context.actor.type !== "user") return [];
  const result = await client.query<CallerMembership>(
    `SELECT role, status FROM tenant_membership
     WHERE tenant_id = $1 AND user_id = $2 AND valid_to IS NULL`,
    [context.tenantId, context.actor.id],
  );
  return result.rows;
}

export function decide(
  action: ReproAction,
  memberships: readonly CallerMembership[],
): ReproAuthorizationDecision {
  const active = memberships.filter((m) => m.status === "active");
  if (active.length === 0) return { allowed: false, reason: "no_active_membership", action };
  if (action === "read") return { allowed: true, reason: "active_member", action };
  const ok = active.some((m) => WRITE_ROLES.has(m.role));
  return ok
    ? { allowed: true, reason: "authorized_role", action }
    : {
        allowed: false,
        reason: `role not permitted for ${action}; requires one of ${[...WRITE_ROLES].join(", ")}`,
        action,
      };
}
