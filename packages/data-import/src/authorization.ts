import { type TenantContext } from "@jk/domain-kernel";
import type pg from "pg";

/**
 * Authorization for Data Import (§66). Running a staged import is an
 * operational write; management and field-operations roles may do it. Reads
 * (preview/status) are allowed for any active member.
 */
export type ImportAction = "run_import" | "read";

const WRITE_ROLES = new Set(["tenant_owner", "farm_manager", "technician"]);

export interface CallerMembership {
  role: string;
  status: string;
}

export interface ImportDecision {
  allowed: boolean;
  reason: string;
  action: ImportAction;
}

export async function loadCallerMemberships(client: pg.PoolClient, context: TenantContext): Promise<CallerMembership[]> {
  if (context.actor.type !== "user") return [];
  const result = await client.query<CallerMembership>(
    `SELECT role, status FROM tenant_membership WHERE tenant_id = $1 AND user_id = $2 AND valid_to IS NULL`,
    [context.tenantId, context.actor.id],
  );
  return result.rows;
}

export function decide(action: ImportAction, context: TenantContext, memberships: readonly CallerMembership[]): ImportDecision {
  if (context.actor.type === "service") return { allowed: true, reason: "service_actor", action };
  const active = memberships.filter((m) => m.status === "active");
  if (active.length === 0) return { allowed: false, reason: "no_active_membership", action };
  if (action === "read") return { allowed: true, reason: "active_member", action };
  const ok = active.some((m) => WRITE_ROLES.has(m.role));
  return ok
    ? { allowed: true, reason: "authorized_role", action }
    : { allowed: false, reason: `role not permitted for ${action}`, action };
}
