import {
  ConcurrencyConflictError,
  IdempotencyConflictError,
  newUlid,
  validateEventEnvelope,
  type DomainEventEnvelope,
} from "@jk/domain-kernel";
import type pg from "pg";

/**
 * Append-only event store + transactional outbox writer (§31.1, §39).
 *
 * appendEvent MUST be called inside an open tenant transaction (the same
 * transaction that mutates domain state), so the domain event, the outbox
 * message, and the state change commit or roll back atomically.
 */

export interface AppendResult {
  eventId: string;
  deduplicated: boolean;
}

/** Build the NATS-style subject for an envelope (§49). */
export function subjectForEvent(
  envelope: DomainEventEnvelope,
  environment: string,
  tenantShard = "a1",
): string {
  // Public topic names never expose raw tenant ids (§49); the envelope carries
  // the tenant id, the subject carries a non-sensitive shard.
  const [context, event, version] = splitEventType(envelope.eventType);
  return `jk.${environment}.${tenantShard}.${context}.${envelope.aggregateType}.${event.replace(/_/g, "-")}.${version}`;
}

function splitEventType(eventType: string): [string, string, string] {
  const parts = eventType.split(".");
  const version = parts.pop()!;
  const event = parts.pop()!;
  const context = parts.join(".");
  return [context, event, version];
}

export async function appendEvent(
  client: pg.PoolClient,
  envelope: DomainEventEnvelope,
  options: { environment?: string } = {},
): Promise<AppendResult> {
  const valid = validateEventEnvelope(envelope);

  // Idempotent replay: the same tenant + idempotency key returns the existing
  // event instead of writing a duplicate (JK-DOM-005, §31.2).
  const existing = await client.query<{ event_id: string; payload: unknown }>(
    "SELECT event_id, payload FROM domain_event WHERE tenant_id = $1 AND idempotency_key = $2",
    [valid.tenantId, valid.idempotencyKey],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0]!;
    if (JSON.stringify(row.payload) !== JSON.stringify(valid.payload)) {
      throw new IdempotencyConflictError(
        `Idempotency key '${valid.idempotencyKey}' was already used with a different payload`,
      );
    }
    return { eventId: row.event_id, deduplicated: true };
  }

  try {
    await client.query(
      `INSERT INTO domain_event (
        event_id, tenant_id, farm_id, event_type, schema_version,
        aggregate_type, aggregate_id, aggregate_version,
        occurred_at, recorded_at, actor_type, actor_id, source_channel,
        correlation_id, causation_id, idempotency_key, payload, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        valid.eventId,
        valid.tenantId,
        valid.farmId,
        valid.eventType,
        valid.schemaVersion,
        valid.aggregateType,
        valid.aggregateId,
        valid.aggregateVersion,
        valid.occurredAt,
        valid.recordedAt,
        valid.actor.type,
        valid.actor.id,
        valid.source.channel,
        valid.correlationId,
        valid.causationId,
        valid.idempotencyKey,
        JSON.stringify(valid.payload),
        JSON.stringify(valid.metadata),
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      // Unique violation on (tenant, aggregate, version): concurrent writer won.
      throw new ConcurrencyConflictError(
        `Aggregate ${valid.aggregateType}/${valid.aggregateId} version ${valid.aggregateVersion} already exists`,
        valid.aggregateVersion,
      );
    }
    throw error;
  }

  const environment = options.environment ?? "local";
  await client.query(
    `INSERT INTO outbox_message (message_id, tenant_id, event_id, subject, envelope)
     VALUES ($1, $2, $3, $4, $5)`,
    [newUlid(), valid.tenantId, valid.eventId, subjectForEvent(valid, environment), JSON.stringify(valid)],
  );

  return { eventId: valid.eventId, deduplicated: false };
}
