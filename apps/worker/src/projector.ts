import {
  assertSameTenant,
  createTenantContext,
  validateEventEnvelope,
  type DomainEventEnvelope,
} from "@jk/domain-kernel";
import { withSystemTransaction } from "@jk/database";
import type pg from "pg";

/**
 * Idempotent projection consumer (§31.1 step 5, §31.2, §42).
 *
 * Phase 0 wiring: the consumer is fed in-process by the outbox relay after a
 * successful publish (same at-least-once contract as a broker subscription —
 * a crash between publish and projection commit causes redelivery on the next
 * relay run). Later phases move this behind a durable JetStream consumer
 * without changing this class: `project(client, envelope)` is the whole
 * contract.
 *
 * Idempotency (§31.2): insert-first into processed_message with
 * ON CONFLICT DO NOTHING inside the SAME transaction as the projection
 * upsert. If the message id was already recorded, the envelope is skipped —
 * redelivery is a no-op. Rebuild (§42): truncate both tables and replay
 * domain_event; calculated_at is refreshed on every upsert.
 */

export const EVENT_STATS_CONSUMER = "event-stats-projector";

export interface ProjectionResult {
  /** True when the envelope was applied; false when deduplicated. */
  applied: boolean;
}

export class EventStatsProjector {
  constructor(private readonly consumerName: string = EVENT_STATS_CONSUMER) {}

  /**
   * Apply one envelope inside an already-open transaction (worker role).
   * Consumers validate envelopes again at consumption (§39).
   */
  async project(
    client: pg.PoolClient,
    candidate: DomainEventEnvelope,
  ): Promise<ProjectionResult> {
    const envelope = validateEventEnvelope(candidate);

    // Dedupe first (§31.2): at-least-once transport, processed ids stored.
    const dedupe = await client.query(
      `INSERT INTO processed_message (consumer_name, message_id)
       VALUES ($1, $2)
       ON CONFLICT (consumer_name, message_id) DO NOTHING`,
      [this.consumerName, envelope.eventId],
    );
    if (dedupe.rowCount === 0) {
      return { applied: false };
    }

    const upsert = await client.query<{ tenant_id: string }>(
      `INSERT INTO projection_event_stats
         (tenant_id, aggregate_type, event_count, last_event_at, calculated_at)
       VALUES ($1, $2, 1, $3, now())
       ON CONFLICT (tenant_id, aggregate_type) DO UPDATE SET
         event_count = projection_event_stats.event_count + 1,
         last_event_at = GREATEST(
           coalesce(projection_event_stats.last_event_at, EXCLUDED.last_event_at),
           EXCLUDED.last_event_at
         ),
         calculated_at = now()
       RETURNING tenant_id`,
      [envelope.tenantId, envelope.aggregateType, envelope.occurredAt],
    );

    // §67: background jobs and event consumers verify envelope tenant against
    // the tenant of the resource they touched. The envelope context can never
    // diverge from the projection row it wrote — defect or attack otherwise.
    const envelopeContext = createTenantContext({
      tenantId: envelope.tenantId,
      actor: envelope.actor,
      correlationId: envelope.correlationId,
    });
    assertSameTenant(envelopeContext, upsert.rows[0]!.tenant_id);

    return { applied: true };
  }

  /** Convenience wrapper: apply one envelope in its own transaction. */
  async projectWithPool(
    pool: pg.Pool,
    envelope: DomainEventEnvelope,
  ): Promise<ProjectionResult> {
    return withSystemTransaction(pool, (client) => this.project(client, envelope));
  }
}
