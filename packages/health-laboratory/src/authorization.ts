import { type TenantContext } from "@jk/domain-kernel";
import type pg from "pg";

/**
 * Authorization for Health and Laboratory (§66). Herd/clinical roles record
 * treatments and manage cases; lifting a sale-clear withdrawal restriction is
 * higher-impact and limited to veterinarian or tenant_owner, always documented
 * (JK-HLT-005). Any active member reads.
 */
export type HealthAction =
  | "record_treatment"
  | "manage_protocols"
  | "manage_cases"
  | "override_restriction"
  | "read";

const TREATMENT_ROLES = new Set([
  "tenant_owner",
  "farm_manager",
  "technician",
  "veterinarian",
]);
const OVERRIDE_ROLES = new Set(["tenant_owner", "veterinarian"]);

export interface CallerMembership {
  role: string;
  status: string;
}

export interface HealthAuthorizationDecision {
  allowed: boolean;
  reason: string;
  action: HealthAction;
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
  action: HealthAction,
  memberships: readonly CallerMembership[],
): HealthAuthorizationDecision {
  const active = memberships.filter((m) => m.status === "active");
  if (active.length === 0)
    return { allowed: false, reason: "no_active_membership", action };
  if (action === "read") return { allowed: true, reason: "active_member", action };

  const roles = new Set(active.map((m) => m.role));
  if (action === "override_restriction") {
    const ok = [...roles].some((r) => OVERRIDE_ROLES.has(r));
    return ok
      ? { allowed: true, reason: "authorized_override_role", action }
      : {
          allowed: false,
          reason: `overriding a withdrawal restriction requires one of ${[...OVERRIDE_ROLES].join(", ")}`,
          action,
        };
  }
  const ok = [...roles].some((r) => TREATMENT_ROLES.has(r));
  return ok
    ? { allowed: true, reason: "authorized_role", action }
    : {
        allowed: false,
        reason: `role not permitted for ${action}; requires one of ${[...TREATMENT_ROLES].join(", ")}`,
        action,
      };
}
