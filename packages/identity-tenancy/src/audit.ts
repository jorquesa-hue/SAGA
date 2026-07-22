import { type ActorContext, type Uuid } from "@jk/domain-kernel";
import type pg from "pg";

/**
 * Append-only security/admin audit stream writer (JK-SEC-009, §68).
 * Distinct from the business domain event ledger; identity administration
 * actions (tenant creation, role changes, invitations, revocations) and
 * authorization denials are audited here, in the same transaction as the
 * action itself so audit and state commit atomically.
 */

export interface AuditEntry {
  /** NULL for platform-level actions (e.g. tenant onboarding pre-context). */
  tenantId: Uuid | null;
  actor: ActorContext;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: "success" | "denied" | "error";
  correlationId?: Uuid | null;
  detail?: Record<string, unknown>;
}

export async function writeAuditRecord(
  client: pg.PoolClient,
  entry: AuditEntry,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_record (
       tenant_id, actor_type, actor_id, action,
       resource_type, resource_id, outcome, correlation_id, detail
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      entry.tenantId,
      entry.actor.type,
      entry.actor.id,
      entry.action,
      entry.resourceType,
      entry.resourceId ?? null,
      entry.outcome,
      entry.correlationId ?? null,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
}
