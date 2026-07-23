import { type TenantContext } from "@jk/domain-kernel";
import type pg from "pg";

/**
 * Authorization for Automation and Integration (§66). Managing webhook
 * subscriptions and connector registrations is a privileged administrative
 * write (it can exfiltrate tenant events), so only management roles may do it.
 * The delivery dispatcher itself runs as a scheduled service actor.
 */
export type IntegrationAction = "manage_integrations" | "read";

const MANAGE_ROLES = new Set(["tenant_owner", "farm_manager", "integration_service"]);

export interface CallerMembership {
  role: string;
  status: string;
}

export interface IntegrationDecision {
  allowed: boolean;
  reason: string;
  action: IntegrationAction;
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
  action: IntegrationAction,
  context: TenantContext,
  memberships: readonly CallerMembership[],
): IntegrationDecision {
  // The dispatcher/relay runs as a scheduled service actor.
  if (context.actor.type === "service") {
    return { allowed: true, reason: "scheduled_actor", action };
  }
  const active = memberships.filter((m) => m.status === "active");
  if (active.length === 0) return { allowed: false, reason: "no_active_membership", action };
  if (action === "read") return { allowed: true, reason: "active_member", action };
  const ok = active.some((m) => MANAGE_ROLES.has(m.role));
  return ok
    ? { allowed: true, reason: "authorized_role", action }
    : { allowed: false, reason: `role not permitted for ${action}`, action };
}
