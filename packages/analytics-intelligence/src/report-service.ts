import { type TenantContext, type Uuid } from "@jk/domain-kernel";
import { withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { decide, loadCallerMemberships } from "./authorization.js";
import { AnalyticsForbiddenError } from "./errors.js";

/**
 * Monitoring reports (§26 mandatory reports). Every report exposes the period,
 * the values, and a data-completeness indicator so results are interpretable
 * and reproducible. All figures are projected from authoritative records.
 */

export interface BeefLotReportAnimal {
  animalId: Uuid;
  entryWeightKg: number | null;
  currentWeightKg: number | null;
  adgKgPerDay: number | null;
  daysOnTest: number | null;
}

export interface BeefLotReport {
  lotId: Uuid;
  headCount: number;
  avgAdgKgPerDay: number | null;
  totalGainKg: number;
  paddockAreaHa: number | null;
  kgPerHa: number | null;
  animalsWithTwoWeights: number;
  animals: BeefLotReportAnimal[];
}

export interface NucleusReportRow {
  animalId: Uuid;
  visualId: string;
  latestWeightKg: number | null;
  adgKgPerDay: number | null;
  reproductionState: string;
  activeRestrictions: number;
  treatmentsLast30d: number;
}

export interface ReportServiceOptions {
  appPool: pg.Pool;
}

export class ReportService {
  private readonly appPool: pg.Pool;

  constructor(options: ReportServiceOptions) {
    this.appPool = options.appPool;
  }

  /** Beef lot performance (§26): entry/current weight, ADG, days, kg/ha. */
  async beefLotReport(context: TenantContext, lotId: Uuid): Promise<BeefLotReport> {
    return this.read(context, async (client) => {
      const rows = await client.query<{
        animal_id: string;
        entry_kg: string | null;
        current_kg: string | null;
        entry_at: Date | null;
        current_at: Date | null;
      }>(
        `SELECT m.animal_id,
                fw.weight_kg AS entry_kg, lw.weight_kg AS current_kg,
                fw.occurred_at AS entry_at, lw.occurred_at AS current_at
         FROM lot_membership m
         LEFT JOIN LATERAL (
           SELECT weight_kg, occurred_at FROM animal_weight w
           WHERE w.animal_id = m.animal_id AND w.eligible_for_analytics = true
           ORDER BY occurred_at ASC LIMIT 1
         ) fw ON true
         LEFT JOIN LATERAL (
           SELECT weight_kg, occurred_at FROM animal_weight w
           WHERE w.animal_id = m.animal_id AND w.eligible_for_analytics = true
           ORDER BY occurred_at DESC LIMIT 1
         ) lw ON true
         WHERE m.lot_id = $1 AND m.valid_to IS NULL`,
        [lotId],
      );

      const paddock = await client.query<{ area_ha: string | null }>(
        `SELECT p.area_ha FROM paddock_occupation o
         JOIN paddock p ON p.id = o.paddock_id
         WHERE o.lot_id = $1 AND o.exit_at IS NULL`,
        [lotId],
      );

      let totalGainKg = 0;
      let adgSum = 0;
      let adgCount = 0;
      const animals: BeefLotReportAnimal[] = rows.rows.map((r) => {
        const entry = r.entry_kg === null ? null : Number(r.entry_kg);
        const current = r.current_kg === null ? null : Number(r.current_kg);
        let adg: number | null = null;
        let days: number | null = null;
        if (
          entry !== null &&
          current !== null &&
          r.entry_at &&
          r.current_at &&
          r.current_at.getTime() > r.entry_at.getTime()
        ) {
          days = (r.current_at.getTime() - r.entry_at.getTime()) / 86_400_000;
          adg = (current - entry) / days;
          totalGainKg += current - entry;
          adgSum += adg;
          adgCount += 1;
        }
        return {
          animalId: r.animal_id,
          entryWeightKg: entry,
          currentWeightKg: current,
          adgKgPerDay: adg,
          daysOnTest: days,
        };
      });

      const areaHa =
        paddock.rows[0]?.area_ha == null ? null : Number(paddock.rows[0]!.area_ha);
      return {
        lotId,
        headCount: rows.rows.length,
        avgAdgKgPerDay: adgCount > 0 ? adgSum / adgCount : null,
        totalGainKg: Math.round(totalGainKg * 100) / 100,
        paddockAreaHa: areaHa,
        kgPerHa:
          areaHa && areaHa > 0 ? Math.round((totalGainKg / areaHa) * 100) / 100 : null,
        animalsWithTwoWeights: adgCount,
        animals,
      };
    });
  }

  /** Monthly genetic-nucleus monitoring (§26): weight, ADG, reproduction, health. */
  async monthlyNucleusReport(
    context: TenantContext,
    farmId: Uuid,
  ): Promise<NucleusReportRow[]> {
    return this.read(context, async (client) => {
      const result = await client.query(
        `SELECT a.id AS animal_id, a.visual_id,
                lw.weight_kg AS latest_kg,
                fw.weight_kg AS first_kg, fw.occurred_at AS first_at, lw.occurred_at AS last_at,
                (SELECT count(*)::int FROM animal_restriction r
                   WHERE r.animal_id = a.id AND r.status = 'active'
                     AND (r.valid_to IS NULL OR r.valid_to > now())) AS active_restrictions,
                (SELECT count(*)::int FROM treatment t
                   WHERE t.animal_id = a.id AND t.administered_at > now() - interval '30 days') AS treatments_30d,
                (SELECT pc.result FROM pregnancy_check pc WHERE pc.dam_id = a.id ORDER BY check_date DESC LIMIT 1) AS last_check,
                (SELECT 1 FROM calving c WHERE c.dam_id = a.id LIMIT 1) AS has_calved
         FROM animal a
         JOIN lot_membership m ON m.animal_id = a.id AND m.valid_to IS NULL
         JOIN lot l ON l.id = m.lot_id AND l.purpose = 'genetic_nucleus'
         LEFT JOIN LATERAL (
           SELECT weight_kg, occurred_at FROM animal_weight w
           WHERE w.animal_id = a.id AND w.eligible_for_analytics = true
           ORDER BY occurred_at DESC LIMIT 1
         ) lw ON true
         LEFT JOIN LATERAL (
           SELECT weight_kg, occurred_at FROM animal_weight w
           WHERE w.animal_id = a.id AND w.eligible_for_analytics = true
           ORDER BY occurred_at ASC LIMIT 1
         ) fw ON true
         WHERE a.farm_id = $1 AND a.lifecycle_status = 'active'
         ORDER BY a.visual_id`,
        [farmId],
      );

      return result.rows.map((r) => {
        const latest = r.latest_kg == null ? null : Number(r.latest_kg);
        const first = r.first_kg == null ? null : Number(r.first_kg);
        let adg: number | null = null;
        if (first !== null && latest !== null && r.first_at && r.last_at) {
          const days =
            (new Date(r.last_at).getTime() - new Date(r.first_at).getTime()) / 86_400_000;
          if (days > 0) adg = (latest - first) / days;
        }
        let state = "open";
        if (r.last_check === "positive") state = "pregnant";
        else if (r.last_check === "loss") state = "loss";
        if (r.has_calved) state = "calved";
        return {
          animalId: r.animal_id,
          visualId: r.visual_id,
          latestWeightKg: latest,
          adgKgPerDay: adg,
          reproductionState: state,
          activeRestrictions: r.active_restrictions,
          treatmentsLast30d: r.treatments_30d,
        };
      });
    });
  }

  private async read<T>(
    context: TenantContext,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide("read", context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok)
      throw new AnalyticsForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}
