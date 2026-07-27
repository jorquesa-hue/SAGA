import { type TenantContext } from "@jk/domain-kernel";
import type pg from "pg";

/**
 * Authorization for Reporting (§47, §66). Reading the catalogue and running a
 * report are reads over authoritative records; recording a run in the ledger
 * is provenance, not a domain mutation, so any active member may run reports.
 * A scheduled service/worker actor may also run reports (recurring reports,
 * Slice 2).
 */
export interface CallerMembership {
  role: string;
  status: string;
}

export interface ReportingDecision {
  allowed: boolean;
  reason: string;
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
  context: TenantContext,
  memberships: readonly CallerMembership[],
): ReportingDecision {
  // A scheduled service/worker actor may run reports (recurring reports).
  if (context.actor.type === "service") {
    return { allowed: true, reason: "scheduled_actor" };
  }
  const active = memberships.filter((m) => m.status === "active");
  if (active.length === 0) return { allowed: false, reason: "no_active_membership" };
  return { allowed: true, reason: "active_member" };
}
