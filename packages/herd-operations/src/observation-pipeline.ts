import {
  createEventEnvelope,
  Measurement,
  newUuid,
  type TenantContext,
} from "@jk/domain-kernel";
import { appendEvent } from "@jk/database";
import type pg from "pg";
import {
  DEFAULT_WEIGHT_CONFIG,
  type ObservationInput,
  type ObservationResult,
  type WeightValidationConfig,
} from "./domain.js";
import { WEIGHT_RECORDED } from "./events.js";

/**
 * The single weight-observation validation pipeline (JK-WGT-002): manual,
 * mobile, CSV, API, and device observations all pass through here. Runs inside
 * an open tenant transaction.
 *
 * Order (JK-WGT-003..006, §11):
 *  1. Idempotent dedup by (gateway, observationId) — replay is safe.
 *  2. Structural validation (weight > 0, known unit).
 *  3. Identity resolution (active RFID → animal); unresolved goes to the
 *     exception queue, never discarded.
 *  4. Normalisation to kilograms (source value preserved).
 *  5. Plausibility flags (out-of-range or implausible daily change) — flagged,
 *     not silently rejected; flagged readings are excluded from analytics.
 *  6. Accept: persist raw+normalised observation, append the immutable
 *     weight_recorded event, and upsert the animal_weight read model.
 */
export async function processObservation(
  client: pg.PoolClient,
  context: TenantContext,
  input: ObservationInput,
  options: { config?: WeightValidationConfig; environment?: string } = {},
): Promise<ObservationResult> {
  const config = options.config ?? DEFAULT_WEIGHT_CONFIG;
  const environment = options.environment ?? "local";
  const gatewayId = input.gatewayId ?? "manual";
  const capturedAt = new Date(input.capturedAt);

  // 1. Dedup.
  const existing = await client.query<{ id: string; resolution_status: string; resolved_animal_id: string | null; event_id: string | null }>(
    `SELECT id, resolution_status, resolved_animal_id, event_id
     FROM device_observation
     WHERE tenant_id = $1 AND gateway_id = $2 AND observation_id = $3`,
    [context.tenantId, gatewayId, input.observationId],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0]!;
    return {
      observationId: input.observationId,
      serverObservationId: row.id,
      status: "duplicate",
      animalId: row.resolved_animal_id,
      eventId: row.event_id,
      qualityFlags: [],
    };
  }

  // 2. Structural validation.
  if (!(input.value > 0) || !["kg", "lb"].includes(input.unit)) {
    return persist(client, context, input, capturedAt, gatewayId, {
      status: "rejected_validation",
      qualityFlags: ["invalid_measurement"],
      reason: "weight must be > 0 with a supported unit",
    });
  }

  // 3. Identity resolution.
  let animalId: string | null = null;
  if (input.rfid) {
    const resolved = await client.query<{ animal_id: string }>(
      `SELECT animal_id FROM animal_identifier
       WHERE identifier_type = 'rfid' AND identifier_value = $1 AND valid_to IS NULL`,
      [input.rfid],
    );
    animalId = resolved.rows[0]?.animal_id ?? null;
  }
  if (!animalId) {
    return persist(client, context, input, capturedAt, gatewayId, {
      status: "pending_resolution",
      qualityFlags: input.rfid ? ["unresolved_identifier"] : ["missing_identifier"],
      reason: input.rfid ? `RFID ${input.rfid} does not resolve to an animal` : "no RFID provided",
    });
  }

  // 4. Normalise to kg (source value preserved by Measurement).
  const measurement = Measurement.of(input.value, input.unit);
  const weightKg = measurement.value;

  // 5. Plausibility.
  const qualityFlags: string[] = [];
  if (weightKg < config.minPlausibleKg || weightKg > config.maxPlausibleKg) {
    qualityFlags.push("out_of_range");
  }
  const prev = await client.query<{ occurred_at: Date; weight_kg: string }>(
    `SELECT occurred_at, weight_kg FROM animal_weight
     WHERE animal_id = $1 AND eligible_for_analytics = true AND occurred_at <= $2
     ORDER BY occurred_at DESC LIMIT 1`,
    [animalId, capturedAt.toISOString()],
  );
  if (prev.rows.length > 0) {
    const prevKg = Number(prev.rows[0]!.weight_kg);
    const elapsedDays = Math.max(
      (capturedAt.getTime() - new Date(prev.rows[0]!.occurred_at).getTime()) / 86_400_000,
      1 / 24,
    );
    const dailyChange = Math.abs(weightKg - prevKg) / elapsedDays;
    if (dailyChange > config.maxDailyChangeKg) {
      qualityFlags.push("implausible_change");
    }
  }
  const eligible = qualityFlags.length === 0;

  // 6. Accept: persist observation, append event, upsert read model.
  const serverObservationId = newUuid();
  const envelope = createEventEnvelope({
    eventType: WEIGHT_RECORDED,
    context,
    aggregateType: "animal",
    aggregateId: animalId,
    aggregateVersion: await nextAnimalVersion(client, context.tenantId, animalId),
    occurredAt: capturedAt,
    source: {
      channel: gatewayId === "manual" ? "api" : "edge",
      deviceId: input.deviceId ?? null,
    },
    idempotencyKey: `weight-${context.tenantId}-${gatewayId}-${input.observationId}`,
    payload: {
      animalId,
      weightKilograms: weightKg,
      observationId: serverObservationId,
      handlingSessionId: input.handlingSessionId ?? null,
      eligibleForAnalytics: eligible,
      qualityFlags,
      sourceValue: measurement.sourceValue,
      sourceUnit: measurement.sourceUnit,
    },
    metadata: { qualityFlags },
  });
  const append = await appendEvent(client, envelope, { environment });

  await client.query(
    `INSERT INTO device_observation
       (id, tenant_id, handling_session_id, gateway_id, device_id, observation_id,
        captured_at, measurement_type, raw_value, unit, rfid, raw_payload,
        quality_flags, resolution_status, resolved_animal_id, normalized_weight_kg, event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'weight',$8,$9,$10,$11,$12,'accepted',$13,$14,$15)`,
    [
      serverObservationId,
      context.tenantId,
      input.handlingSessionId ?? null,
      gatewayId,
      input.deviceId ?? null,
      input.observationId,
      capturedAt.toISOString(),
      input.value,
      input.unit,
      input.rfid ?? null,
      input.rawPayload ? JSON.stringify(input.rawPayload) : null,
      qualityFlags,
      animalId,
      weightKg,
      append.eventId,
    ],
  );

  await client.query(
    `INSERT INTO animal_weight
       (tenant_id, animal_id, occurred_at, weight_kg, eligible_for_analytics,
        quality_flags, source_observation_id, event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, event_id) DO NOTHING`,
    [
      context.tenantId,
      animalId,
      capturedAt.toISOString(),
      weightKg,
      eligible,
      qualityFlags,
      serverObservationId,
      append.eventId,
    ],
  );

  return {
    observationId: input.observationId,
    serverObservationId,
    status: "accepted",
    animalId,
    eventId: append.eventId,
    qualityFlags,
  };
}

async function persist(
  client: pg.PoolClient,
  context: TenantContext,
  input: ObservationInput,
  capturedAt: Date,
  gatewayId: string,
  outcome: { status: ObservationResult["status"]; qualityFlags: string[]; reason: string },
): Promise<ObservationResult> {
  const id = newUuid();
  await client.query(
    `INSERT INTO device_observation
       (id, tenant_id, handling_session_id, gateway_id, device_id, observation_id,
        captured_at, measurement_type, raw_value, unit, rfid, raw_payload,
        quality_flags, resolution_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'weight',$8,$9,$10,$11,$12,$13)`,
    [
      id,
      context.tenantId,
      input.handlingSessionId ?? null,
      gatewayId,
      input.deviceId ?? null,
      input.observationId,
      capturedAt.toISOString(),
      Number.isFinite(input.value) ? input.value : null,
      input.unit,
      input.rfid ?? null,
      input.rawPayload ? JSON.stringify(input.rawPayload) : null,
      outcome.qualityFlags,
      outcome.status,
    ],
  );
  return {
    observationId: input.observationId,
    serverObservationId: id,
    status: outcome.status,
    animalId: null,
    eventId: null,
    qualityFlags: outcome.qualityFlags,
    reason: outcome.reason,
  };
}

async function nextAnimalVersion(
  client: pg.PoolClient,
  tenantId: string,
  animalId: string,
): Promise<number> {
  const result = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
     FROM domain_event
     WHERE tenant_id = $1 AND aggregate_type = 'animal' AND aggregate_id = $2`,
    [tenantId, animalId],
  );
  return result.rows[0]!.next;
}
