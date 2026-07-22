import { type TenantContext } from "@jk/domain-kernel";
import type pg from "pg";

/**
 * Authorization for the Animal Registry context (§66). Roles that operate the
 * herd may register animals and manage identifiers; any active member may read.
 *
 * Membership is owned by the Identity and Tenancy context. This module reads
 * (never writes) `tenant_membership` under RLS to make its own decision; a
 * shared MembershipReader port is the intended future extraction so contexts
 * do not couple through a table. The read is tenant-scoped by RLS and by an
 * explicit predicate (§67 defense in depth).
 */

export type AnimalAction = "register_animal" | "manage_identifiers" | "read";

const WRITE_ROLES = new Set(["tenant_owner", "farm_manager", "technician"]);

export interface CallerMembership {
  role: string;
  status: string;
}

export interface AnimalAuthorizationDecision {
  allowed: boolean;
  reason: string;
  action: AnimalAction;
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
  action: AnimalAction,
  memberships: readonly CallerMembership[],
): AnimalAuthorizationDecision {
  const active = memberships.filter((m) => m.status === "active");
  if (active.length === 0) {
    return { allowed: false, reason: "no_active_membership", action };
  }
  if (action === "read") {
    return { allowed: true, reason: "active_member", action };
  }
  const canWrite = active.some((m) => WRITE_ROLES.has(m.role));
  return canWrite
    ? { allowed: true, reason: "authorized_role", action }
    : {
        allowed: false,
        reason: `role not permitted for ${action}; requires one of ${[...WRITE_ROLES].join(", ")}`,
        action,
      };
}
