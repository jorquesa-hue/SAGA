import { type TenantContext } from "@jk/domain-kernel";
import type pg from "pg";

/**
 * Authorization for Herd Operations (§66). Herd roles run handling sessions
 * and capture/review weights; any active member reads. Membership is read
 * (never written) from the Identity context under RLS — a shared reader port
 * is the intended future extraction.
 */

export type HerdAction =
  | "start_session"
  | "record_weight"
  | "review_observation"
  | "read";

const WRITE_ROLES = new Set(["tenant_owner", "farm_manager", "technician"]);

export interface CallerMembership {
  role: string;
  status: string;
}

export interface HerdAuthorizationDecision {
  allowed: boolean;
  reason: string;
  action: HerdAction;
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
  action: HerdAction,
  memberships: readonly CallerMembership[],
): HerdAuthorizationDecision {
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

/**
 * Device/service actors (edge ingestion) are authorized to record weights via
 * their integration credentials, not tenant membership. They may only record
 * observations, never manage sessions or review exceptions.
 */
export function decideServiceActor(
  context: TenantContext,
  action: HerdAction,
): HerdAuthorizationDecision {
  if ((context.actor.type === "device" || context.actor.type === "service") && action === "record_weight") {
    return { allowed: true, reason: "integration_actor", action };
  }
  return { allowed: false, reason: "integration actor may only record weights", action };
}
