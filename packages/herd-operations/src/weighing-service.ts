import {
  createEventEnvelope,
  NotFoundError,
  type TenantContext,
  type Uuid,
  ValidationError,
} from "@jk/domain-kernel";
import { appendEvent, withTenantTransaction } from "@jk/database";
import type pg from "pg";
import {
  decide,
  decideServiceActor,
  loadCallerMemberships,
  type HerdAction,
} from "./authorization.js";
import {
  observationInputSchema,
  parseInput,
  startSessionInputSchema,
  type AdgResult,
  type HandlingSession,
  type ObservationInput,
  type ObservationResult,
  type SessionSummary,
  type StartSessionInput,
  type WeightPoint,
  type WeightValidationConfig,
} from "./domain.js";
import { HerdForbiddenError } from "./errors.js";
import { SESSION_CLOSED, SESSION_STARTED } from "./events.js";
import { processObservation } from "./observation-pipeline.js";

/** A handling session with its live progress, not just its stored summary. */
export interface HandlingSessionSummary {
  id: Uuid;
  farmId: Uuid;
  farmName: string;
  purpose: string;
  status: string;
  deviceId: string | null;
  expectedCount: number | null;
  recordedCount: number;
  unresolvedCount: number;
  startedAt: string;
  closedAt: string | null;
}

/** One weighing, carrying the analytics-eligibility flag that governs its use. */
export interface RecentWeight {
  id: Uuid;
  animalId: Uuid;
  visualId: string;
  occurredAt: string;
  weightKg: number;
  eligibleForAnalytics: boolean;
  qualityFlags: string[];
}

export interface WeighingServiceOptions {
  appPool: pg.Pool;
  environment?: string;
  weightConfig?: WeightValidationConfig;
}

interface SessionRow {
  id: string;
  tenant_id: string;
  farm_id: string;
  purpose: HandlingSession["purpose"];
  status: HandlingSession["status"];
  device_id: string | null;
  operator_id: string | null;
  expected_count: number | null;
  started_at: Date;
  closed_at: Date | null;
  summary: SessionSummary | null;
}

function mapSession(row: SessionRow): HandlingSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    farmId: row.farm_id,
    purpose: row.purpose,
    status: row.status,
    deviceId: row.device_id,
    operatorId: row.operator_id,
    expectedCount: row.expected_count,
    startedAt: row.started_at,
    closedAt: row.closed_at,
    summary: row.summary,
  };
}

/**
 * Weighing and handling-session service (JK-WGT-001..008, §11, §19). Handling
 * sessions group observations; every observation flows through the single
 * validation pipeline; unresolved/rejected readings stay in an exception queue
 * and are never discarded; closing a session summarises counts.
 */
export class WeighingService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;
  private readonly weightConfig?: WeightValidationConfig;

  constructor(options: WeighingServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
    this.weightConfig = options.weightConfig;
  }

  async startSession(
    context: TenantContext,
    rawInput: StartSessionInput,
  ): Promise<HandlingSession> {
    const input = parseInput(startSessionInputSchema, rawInput, "startSession input");
    return this.authorized(context, "start_session", async (client) => {
      const farm = await client.query(`SELECT 1 FROM farm WHERE id = $1`, [input.farmId]);
      if (farm.rows.length === 0)
        throw new NotFoundError(`Farm ${input.farmId} not found`);

      const inserted = await client.query<SessionRow>(
        `INSERT INTO handling_session
           (tenant_id, farm_id, purpose, status, device_id, operator_id, expected_count)
         VALUES ($1,$2,$3,'open',$4,$5,$6)
         RETURNING *`,
        [
          context.tenantId,
          input.farmId,
          input.purpose,
          input.deviceId ?? null,
          context.actor.type === "user" ? context.actor.id : null,
          input.expectedCount ?? null,
        ],
      );
      const session = mapSession(inserted.rows[0]!);
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: SESSION_STARTED,
          context,
          farmId: input.farmId,
          aggregateType: "handling_session",
          aggregateId: session.id,
          aggregateVersion: 1,
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `session-start-${session.id}`,
          payload: {
            handlingSessionId: session.id,
            farmId: input.farmId,
            purpose: input.purpose,
            expectedCount: input.expectedCount ?? null,
          },
        }),
        { environment: this.environment },
      );
      return session;
    });
  }

  /**
   * Record a single weight observation through the validation pipeline.
   * Usable by human operators (user actor) and by integration actors
   * (device/service) — the batch device endpoint reuses `ingestBatch`.
   */
  async recordObservation(
    context: TenantContext,
    rawInput: ObservationInput,
  ): Promise<ObservationResult> {
    const input = parseInput(observationInputSchema, rawInput, "observation input");
    return this.authorizedForRecording(context, async (client) => {
      if (input.handlingSessionId) {
        await this.assertOpenSession(client, input.handlingSessionId);
      }
      return processObservation(client, context, input, {
        config: this.weightConfig,
        environment: this.environment,
      });
    });
  }

  /**
   * Ingest a batch of observations in one transaction; each is processed
   * independently and returns its own result (partial success). One bad item
   * never hides the status of others (JK-WGT batch acceptance, §19).
   */
  async ingestBatch(
    context: TenantContext,
    rawObservations: ObservationInput[],
  ): Promise<ObservationResult[]> {
    if (!Array.isArray(rawObservations) || rawObservations.length === 0) {
      throw new ValidationError("A non-empty observations array is required");
    }
    if (rawObservations.length > 2000) {
      throw new ValidationError("A batch may contain at most 2000 observations");
    }
    return this.authorizedForRecording(context, async (client) => {
      const results: ObservationResult[] = [];
      for (const raw of rawObservations) {
        const parsed = observationInputSchema.safeParse(raw);
        if (!parsed.success) {
          results.push({
            observationId:
              (raw as { observationId?: string })?.observationId ?? "unknown",
            serverObservationId: null,
            status: "rejected_validation",
            animalId: null,
            eventId: null,
            qualityFlags: ["invalid_schema"],
            reason: parsed.error.issues.map((i) => i.message).join("; "),
          });
          continue;
        }
        if (parsed.data.handlingSessionId) {
          await this.assertOpenSession(client, parsed.data.handlingSessionId);
        }
        // Each observation gets its own savepoint so one failure cannot abort
        // the batch transaction (partial success).
        await client.query("SAVEPOINT obs");
        try {
          results.push(
            await processObservation(client, context, parsed.data, {
              config: this.weightConfig,
              environment: this.environment,
            }),
          );
          await client.query("RELEASE SAVEPOINT obs");
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT obs");
          results.push({
            observationId: parsed.data.observationId,
            serverObservationId: null,
            status: "retryable_error",
            animalId: null,
            eventId: null,
            qualityFlags: ["processing_error"],
            reason: (error as Error).message,
          });
        }
      }
      return results;
    });
  }

  /** Exception queue: unresolved / rejected observations (JK-WGT-003). */
  async listExceptions(
    context: TenantContext,
    handlingSessionId?: Uuid,
  ): Promise<
    Array<{
      serverObservationId: Uuid;
      observationId: string;
      status: string;
      rfid: string | null;
      qualityFlags: string[];
      capturedAt: Date;
    }>
  > {
    return this.authorized(context, "read", async (client) => {
      const result = handlingSessionId
        ? await client.query(
            `SELECT id, observation_id, resolution_status, rfid, quality_flags, captured_at
             FROM device_observation
             WHERE handling_session_id = $1
               AND resolution_status IN ('pending_resolution','rejected_validation','retryable_error')
             ORDER BY captured_at`,
            [handlingSessionId],
          )
        : await client.query(
            `SELECT id, observation_id, resolution_status, rfid, quality_flags, captured_at
             FROM device_observation
             WHERE resolution_status IN ('pending_resolution','rejected_validation','retryable_error')
             ORDER BY captured_at`,
          );
      return result.rows.map((r) => ({
        serverObservationId: r.id,
        observationId: r.observation_id,
        status: r.resolution_status,
        rfid: r.rfid,
        qualityFlags: r.quality_flags,
        capturedAt: r.captured_at,
      }));
    });
  }

  async closeSession(context: TenantContext, sessionId: Uuid): Promise<HandlingSession> {
    return this.authorized(context, "start_session", async (client) => {
      const session = await client.query<SessionRow>(
        `SELECT * FROM handling_session WHERE id = $1`,
        [sessionId],
      );
      if (session.rows.length === 0)
        throw new NotFoundError(`Handling session ${sessionId} not found`);
      if (session.rows[0]!.status === "closed") {
        return mapSession(session.rows[0]!);
      }

      const counts = await client.query<{ resolution_status: string; n: string }>(
        `SELECT resolution_status, count(*)::text AS n
         FROM device_observation WHERE handling_session_id = $1
         GROUP BY resolution_status`,
        [sessionId],
      );
      const by = (s: string) =>
        Number(counts.rows.find((r) => r.resolution_status === s)?.n ?? 0);
      const accepted = by("accepted");
      const processed = counts.rows.reduce((sum, r) => sum + Number(r.n), 0);
      // Flagged = accepted observations carrying quality flags.
      const flaggedRow = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM device_observation
         WHERE handling_session_id = $1 AND resolution_status = 'accepted'
           AND array_length(quality_flags, 1) > 0`,
        [sessionId],
      );
      const summary: SessionSummary = {
        expected: session.rows[0]!.expected_count,
        processed,
        accepted,
        flagged: Number(flaggedRow.rows[0]!.n),
        duplicate: by("duplicate"),
        pendingResolution: by("pending_resolution"),
        rejected: by("rejected_validation") + by("retryable_error"),
      };

      const updated = await client.query<SessionRow>(
        `UPDATE handling_session
         SET status = 'closed', closed_at = now(), summary = $2
         WHERE id = $1 RETURNING *`,
        [sessionId, JSON.stringify(summary)],
      );
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: SESSION_CLOSED,
          context,
          farmId: updated.rows[0]!.farm_id,
          aggregateType: "handling_session",
          aggregateId: sessionId,
          aggregateVersion: await this.nextSessionVersion(
            client,
            context.tenantId,
            sessionId,
          ),
          source: { channel: "api" },
          idempotencyKey: `session-close-${sessionId}`,
          payload: { handlingSessionId: sessionId, summary },
        }),
        { environment: this.environment },
      );
      return mapSession(updated.rows[0]!);
    });
  }

  async getWeightSeries(context: TenantContext, animalId: Uuid): Promise<WeightPoint[]> {
    return this.authorized(context, "read", async (client) => {
      const result = await client.query(
        `SELECT occurred_at, weight_kg, eligible_for_analytics, quality_flags, event_id
         FROM animal_weight WHERE animal_id = $1 ORDER BY occurred_at`,
        [animalId],
      );
      return result.rows.map((r) => ({
        occurredAt: r.occurred_at,
        weightKg: Number(r.weight_kg),
        eligibleForAnalytics: r.eligible_for_analytics,
        qualityFlags: r.quality_flags,
        eventId: r.event_id,
      }));
    });
  }

  /** ADG from eligible validated readings only (JK-WGT-006, §11). */
  async computeAdg(context: TenantContext, animalId: Uuid): Promise<AdgResult | null> {
    return this.authorized(context, "read", async (client) => {
      const eligible = await client.query<{ occurred_at: Date; weight_kg: string }>(
        `SELECT occurred_at, weight_kg FROM animal_weight
         WHERE animal_id = $1 AND eligible_for_analytics = true
         ORDER BY occurred_at`,
        [animalId],
      );
      const excluded = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM animal_weight
         WHERE animal_id = $1 AND eligible_for_analytics = false`,
        [animalId],
      );
      if (eligible.rows.length < 2) return null;
      const first = eligible.rows[0]!;
      const last = eligible.rows[eligible.rows.length - 1]!;
      const firstKg = Number(first.weight_kg);
      const lastKg = Number(last.weight_kg);
      const elapsedDays =
        (new Date(last.occurred_at).getTime() - new Date(first.occurred_at).getTime()) /
        86_400_000;
      if (elapsedDays <= 0) return null;
      return {
        animalId,
        firstWeightKg: firstKg,
        lastWeightKg: lastKg,
        firstAt: first.occurred_at,
        lastAt: last.occurred_at,
        elapsedDays,
        adgKgPerDay: (lastKg - firstKg) / elapsedDays,
        eligiblePoints: eligible.rows.length,
        excludedPoints: Number(excluded.rows[0]!.n),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async assertOpenSession(client: pg.PoolClient, sessionId: Uuid): Promise<void> {
    const result = await client.query<{ status: string }>(
      `SELECT status FROM handling_session WHERE id = $1`,
      [sessionId],
    );
    if (result.rows.length === 0)
      throw new NotFoundError(`Handling session ${sessionId} not found`);
    if (result.rows[0]!.status !== "open") {
      throw new ValidationError(`Handling session ${sessionId} is closed`);
    }
  }

  /**
   * Recent handling sessions with what each one actually recorded. The counts
   * come from the observations, not from the session's own summary, so a
   * session that is still open reports its progress rather than nothing.
   */
  async listSessions(
    context: TenantContext,
    limit = 25,
  ): Promise<HandlingSessionSummary[]> {
    return this.authorized(context, "read", async (client) => {
      const result = await client.query<{
        id: string;
        farm_id: string;
        farm_name: string;
        purpose: string;
        status: string;
        device_id: string | null;
        expected_count: number | null;
        started_at: Date;
        closed_at: Date | null;
        recorded: string;
        unresolved: string;
      }>(
        `SELECT s.id, s.farm_id, f.name AS farm_name, s.purpose, s.status,
                s.device_id, s.expected_count, s.started_at, s.closed_at,
                count(o.id) FILTER (WHERE o.resolution_status = 'accepted') AS recorded,
                count(o.id) FILTER (WHERE o.resolution_status = 'pending_resolution')
                  AS unresolved
           FROM handling_session s
           JOIN farm f ON f.id = s.farm_id
           LEFT JOIN device_observation o ON o.handling_session_id = s.id
          GROUP BY s.id, f.name
          ORDER BY s.started_at DESC
          LIMIT $1`,
        [Math.min(Math.max(limit, 1), 200)],
      );
      return result.rows.map((r) => ({
        id: r.id,
        farmId: r.farm_id,
        farmName: r.farm_name,
        purpose: r.purpose,
        status: r.status,
        deviceId: r.device_id,
        expectedCount: r.expected_count,
        recordedCount: Number(r.recorded),
        unresolvedCount: Number(r.unresolved),
        startedAt: r.started_at.toISOString(),
        closedAt: r.closed_at?.toISOString() ?? null,
      }));
    });
  }

  /** Most recent weighings across the herd, newest first. */
  async listRecentWeights(context: TenantContext, limit = 50): Promise<RecentWeight[]> {
    return this.authorized(context, "read", async (client) => {
      const result = await client.query<{
        id: string;
        animal_id: string;
        visual_id: string;
        occurred_at: Date;
        weight_kg: string;
        eligible_for_analytics: boolean;
        quality_flags: string[];
      }>(
        `SELECT w.id, w.animal_id, a.visual_id, w.occurred_at, w.weight_kg,
                w.eligible_for_analytics, w.quality_flags
           FROM animal_weight w
           JOIN animal a ON a.id = w.animal_id
          ORDER BY w.occurred_at DESC, a.visual_id
          LIMIT $1`,
        [Math.min(Math.max(limit, 1), 500)],
      );
      return result.rows.map((r) => ({
        id: r.id,
        animalId: r.animal_id,
        visualId: r.visual_id,
        occurredAt: r.occurred_at.toISOString(),
        weightKg: Number(r.weight_kg),
        eligibleForAnalytics: r.eligible_for_analytics,
        qualityFlags: r.quality_flags,
      }));
    });
  }

  private async nextSessionVersion(
    client: pg.PoolClient,
    tenantId: string,
    sessionId: string,
  ): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event
       WHERE tenant_id = $1 AND aggregate_type = 'handling_session' AND aggregate_id = $2`,
      [tenantId, sessionId],
    );
    return result.rows[0]!.next;
  }

  private async authorized<T>(
    context: TenantContext,
    action: HerdAction,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide(action, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok)
      throw new HerdForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }

  /** Recording is open to herd users OR integration (device/service) actors. */
  private async authorizedForRecording<T>(
    context: TenantContext,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      let decision;
      if (context.actor.type === "device" || context.actor.type === "service") {
        decision = decideServiceActor(context, "record_weight");
      } else {
        const memberships = await loadCallerMemberships(client, context);
        decision = decide("record_weight", memberships);
      }
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok)
      throw new HerdForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}
