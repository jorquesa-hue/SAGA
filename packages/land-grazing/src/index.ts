import {
  createEventEnvelope,
  NotFoundError,
  PlatformError,
  ValidationError,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import { appendEvent, withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { z } from "zod";

/**
 * Land and Grazing service (JK-PAS-001..004, §14, §20): pasture assessments and
 * the grazing metrics they feed (stocking rate, grazing days, kg/ha). Metrics
 * disclose their calculation period and data completeness (§59 safeguard).
 */

export const PASTURE_ASSESSED = "land.pasture_assessed.v1";
const WRITE_ROLES = new Set(["tenant_owner", "farm_manager", "technician"]);

export class LandForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
}

export const assessmentInputSchema = z
  .object({
    paddockId: z.string().uuid(),
    method: z
      .enum(["visual", "rising_plate", "sward_stick", "cut_and_weigh", "other"])
      .default("visual"),
    condition: z.enum(["poor", "fair", "good", "excellent"]),
    availabilityKgDmHa: z.number().nonnegative().optional(),
    notes: z.string().max(1000).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type AssessmentInput = z.input<typeof assessmentInputSchema>;

export interface PastureAssessment {
  id: Uuid;
  paddockId: Uuid;
  assessedAt: Date;
  method: string;
  condition: string;
  availabilityKgDmHa: number | null;
}

export interface GrazingMetrics {
  paddockId: Uuid;
  areaHa: number | null;
  currentLotId: Uuid | null;
  currentHeadCount: number;
  stockingRateHeadPerHa: number | null;
  totalGrazingDays: number;
  latestCondition: string | null;
  latestAvailabilityKgDmHa: number | null;
  kgPerHa: number | null;
  dataComplete: boolean;
  calculatedAt: string;
}

export interface LandGrazingServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

/**
 * A paddock with the two things that decide whether a lot stays or moves:
 * who is standing in it and how much dry matter was last measured on it.
 */
export interface PaddockRow {
  id: Uuid;
  farmId: Uuid;
  farmName: string;
  name: string;
  areaHa: number | null;
  pastureType: string | null;
  waterAvailable: boolean;
  status: string;
  currentLotId: Uuid | null;
  currentLotName: string | null;
  headCount: number | null;
  occupiedSince: string | null;
  lastAssessedAt: string | null;
  lastCondition: string | null;
  lastAvailabilityKgDmHa: number | null;
}

export class LandGrazingService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: LandGrazingServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  async recordAssessment(
    context: TenantContext,
    rawInput: AssessmentInput,
  ): Promise<PastureAssessment> {
    const input = this.parse(assessmentInputSchema, rawInput);
    return this.authorized(context, true, async (client) => {
      const paddock = await client.query(`SELECT 1 FROM paddock WHERE id = $1`, [
        input.paddockId,
      ]);
      if (paddock.rows.length === 0)
        throw new NotFoundError(`Paddock ${input.paddockId} not found`);
      const inserted = await client.query(
        `INSERT INTO pasture_assessment
           (tenant_id, paddock_id, method, condition, availability_kg_dm_ha, assessed_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, paddock_id, assessed_at, method, condition, availability_kg_dm_ha`,
        [
          context.tenantId,
          input.paddockId,
          input.method,
          input.condition,
          input.availabilityKgDmHa ?? null,
          context.actor.type === "user" ? context.actor.id : null,
          input.notes ?? null,
        ],
      );
      const r = inserted.rows[0]!;
      const append = await appendEvent(
        client,
        createEventEnvelope({
          eventType: PASTURE_ASSESSED,
          context,
          aggregateType: "paddock",
          aggregateId: input.paddockId,
          aggregateVersion: await this.nextVersion(
            client,
            context.tenantId,
            input.paddockId,
          ),
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `assessment-${r.id}`,
          payload: {
            paddockId: input.paddockId,
            condition: input.condition,
            availabilityKgDmHa: input.availabilityKgDmHa ?? null,
          },
        }),
        { environment: this.environment },
      );
      await client.query(`UPDATE pasture_assessment SET event_id = $2 WHERE id = $1`, [
        r.id,
        append.eventId,
      ]);
      return {
        id: r.id,
        paddockId: r.paddock_id,
        assessedAt: r.assessed_at,
        method: r.method,
        condition: r.condition,
        availabilityKgDmHa:
          r.availability_kg_dm_ha === null ? null : Number(r.availability_kg_dm_ha),
      };
    });
  }

  async listAssessments(
    context: TenantContext,
    paddockId: Uuid,
  ): Promise<PastureAssessment[]> {
    return this.authorized(context, false, async (client) => {
      const result = await client.query(
        `SELECT id, paddock_id, assessed_at, method, condition, availability_kg_dm_ha
         FROM pasture_assessment WHERE paddock_id = $1 ORDER BY assessed_at DESC`,
        [paddockId],
      );
      return result.rows.map((r) => ({
        id: r.id,
        paddockId: r.paddock_id,
        assessedAt: r.assessed_at,
        method: r.method,
        condition: r.condition,
        availabilityKgDmHa:
          r.availability_kg_dm_ha === null ? null : Number(r.availability_kg_dm_ha),
      }));
    });
  }

  /** Grazing metrics for a paddock (JK-PAS-004): stocking, grazing days, kg/ha. */
  async getGrazingMetrics(
    context: TenantContext,
    paddockId: Uuid,
  ): Promise<GrazingMetrics> {
    return this.authorized(context, false, async (client) => {
      const paddock = await client.query<{ area_ha: string | null }>(
        `SELECT area_ha FROM paddock WHERE id = $1`,
        [paddockId],
      );
      if (paddock.rows.length === 0)
        throw new NotFoundError(`Paddock ${paddockId} not found`);
      const areaHa =
        paddock.rows[0]!.area_ha == null ? null : Number(paddock.rows[0]!.area_ha);

      const current = await client.query<{ lot_id: string }>(
        `SELECT lot_id FROM paddock_occupation WHERE paddock_id = $1 AND exit_at IS NULL LIMIT 1`,
        [paddockId],
      );
      const currentLotId = current.rows[0]?.lot_id ?? null;

      let headCount = 0;
      let kgGain = 0;
      let gainComplete = true;
      if (currentLotId) {
        const members = await client.query<{ animal_id: string }>(
          `SELECT animal_id FROM lot_membership WHERE lot_id = $1 AND valid_to IS NULL`,
          [currentLotId],
        );
        headCount = members.rows.length;
        for (const m of members.rows) {
          const w = await client.query<{
            first_kg: string | null;
            last_kg: string | null;
          }>(
            `SELECT
               (SELECT weight_kg FROM animal_weight WHERE animal_id = $1 AND eligible_for_analytics ORDER BY occurred_at ASC LIMIT 1) AS first_kg,
               (SELECT weight_kg FROM animal_weight WHERE animal_id = $1 AND eligible_for_analytics ORDER BY occurred_at DESC LIMIT 1) AS last_kg`,
            [m.animal_id],
          );
          const first = w.rows[0]!.first_kg;
          const last = w.rows[0]!.last_kg;
          if (first !== null && last !== null && first !== last) {
            kgGain += Number(last) - Number(first);
          } else {
            gainComplete = false;
          }
        }
      }

      const grazing = await client.query<{ days: string | null }>(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(exit_at, now()) - entry_at)) / 86400), 0)::text AS days
         FROM paddock_occupation WHERE paddock_id = $1`,
        [paddockId],
      );
      const totalGrazingDays = Math.round(Number(grazing.rows[0]!.days) * 10) / 10;

      const assess = await client.query<{
        condition: string;
        availability_kg_dm_ha: string | null;
      }>(
        `SELECT condition, availability_kg_dm_ha FROM pasture_assessment
         WHERE paddock_id = $1 ORDER BY assessed_at DESC LIMIT 1`,
        [paddockId],
      );

      return {
        paddockId,
        areaHa,
        currentLotId,
        currentHeadCount: headCount,
        stockingRateHeadPerHa:
          areaHa && areaHa > 0 ? Math.round((headCount / areaHa) * 100) / 100 : null,
        totalGrazingDays,
        latestCondition: assess.rows[0]?.condition ?? null,
        latestAvailabilityKgDmHa:
          assess.rows[0]?.availability_kg_dm_ha == null
            ? null
            : Number(assess.rows[0]!.availability_kg_dm_ha),
        kgPerHa: areaHa && areaHa > 0 ? Math.round((kgGain / areaHa) * 100) / 100 : null,
        dataComplete: gainComplete && headCount > 0 && areaHa !== null,
        calculatedAt: new Date().toISOString(),
      };
    });
  }

  // -- internals --
  private parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(
        "Invalid input",
        result.error.issues.map((i) => ({ field: i.path.join("."), reason: i.message })),
      );
    }
    return result.data;
  }

  private async nextVersion(
    client: pg.PoolClient,
    tenantId: string,
    paddockId: string,
  ): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event WHERE tenant_id = $1 AND aggregate_type = 'paddock' AND aggregate_id = $2`,
      [tenantId, paddockId],
    );
    return result.rows[0]!.next;
  }

  /** Every paddock with its current occupant and latest assessment. */
  async listPaddocks(context: TenantContext): Promise<PaddockRow[]> {
    return this.authorized(context, false, async (client) => {
      const result = await client.query<{
        id: string;
        farm_id: string;
        farm_name: string;
        name: string;
        area_ha: string | null;
        pasture_type: string | null;
        water_available: boolean;
        status: string;
        lot_id: string | null;
        lot_name: string | null;
        head_count: number | null;
        entry_at: Date | null;
        assessed_at: Date | null;
        condition: string | null;
        availability: string | null;
      }>(
        `SELECT p.id, p.farm_id, f.name AS farm_name, p.name, p.area_ha,
                p.pasture_type, p.water_available, p.status,
                o.lot_id, l.name AS lot_name, o.head_count, o.entry_at,
                a.assessed_at, a.condition, a.availability_kg_dm_ha AS availability
           FROM paddock p
           JOIN farm f ON f.id = p.farm_id
           LEFT JOIN paddock_occupation o ON o.paddock_id = p.id AND o.exit_at IS NULL
           LEFT JOIN lot l ON l.id = o.lot_id
           LEFT JOIN LATERAL (
             SELECT assessed_at, condition, availability_kg_dm_ha
               FROM pasture_assessment
              WHERE paddock_id = p.id
              ORDER BY assessed_at DESC
              LIMIT 1
           ) a ON true
          ORDER BY f.name, p.name`,
      );
      return result.rows.map((r) => ({
        id: r.id,
        farmId: r.farm_id,
        farmName: r.farm_name,
        name: r.name,
        areaHa: r.area_ha === null ? null : Number(r.area_ha),
        pastureType: r.pasture_type,
        waterAvailable: r.water_available,
        status: r.status,
        currentLotId: r.lot_id,
        currentLotName: r.lot_name,
        headCount: r.head_count,
        occupiedSince: r.entry_at?.toISOString() ?? null,
        lastAssessedAt: r.assessed_at?.toISOString() ?? null,
        lastCondition: r.condition,
        lastAvailabilityKgDmHa: r.availability === null ? null : Number(r.availability),
      }));
    });
  }

  private async authorized<T>(
    context: TenantContext,
    write: boolean,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships =
        context.actor.type === "user"
          ? (
              await client.query<{ role: string; status: string }>(
                `SELECT role, status FROM tenant_membership WHERE tenant_id = $1 AND user_id = $2 AND valid_to IS NULL`,
                [context.tenantId, context.actor.id],
              )
            ).rows
          : [];
      const active = memberships.filter((m) => m.status === "active");
      if (active.length === 0)
        return { ok: false as const, reason: "no_active_membership" };
      if (write && !active.some((m) => WRITE_ROLES.has(m.role))) {
        return {
          ok: false as const,
          reason: "role not permitted for pasture assessment",
        };
      }
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new LandForbiddenError(outcome.reason);
    return outcome.value;
  }
}
