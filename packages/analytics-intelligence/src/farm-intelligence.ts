import { type TenantContext, type Uuid } from "@jk/domain-kernel";
import { withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { decide, loadCallerMemberships } from "./authorization.js";
import { AnalyticsForbiddenError } from "./errors.js";

/**
 * Farm Intelligence Index (§60) and executive dashboard (§26). The FII is a
 * versioned, transparent composite (0-100) measuring operational control and
 * data readiness — NOT biological merit. Every component score, weight, and
 * weighted contribution is exposed so the number is explainable and
 * reproducible. The formula version is stored with the result.
 */

export const FII_FORMULA_VERSION = "fii-v1";

export interface FiiComponent {
  domain: string;
  score: number; // 0..1
  weight: number;
  weightedContribution: number; // score * weight
  detail: Record<string, unknown>;
}

export interface FarmIntelligenceIndex {
  farmId: Uuid | null;
  formulaVersion: string;
  score: number; // 0..100
  components: FiiComponent[];
  calculatedAt: string;
}

export interface ExecutiveDashboard {
  farmId: Uuid | null;
  herd: { active: number; byStatus: Record<string, number> };
  reproduction: { pregnant: number; served: number };
  health: { activeRestrictions: number; openCases: number };
  alerts: { open: number; bySeverity: Record<string, number> };
  farmIntelligenceIndex: number;
  calculatedAt: string;
}

const WEIGHTS_V1: Record<string, number> = {
  identity_traceability: 0.2,
  timely_measurement: 0.2,
  reproduction_control: 0.15,
  health_compliance: 0.15,
  pasture_visibility: 0.15,
  exception_burden: 0.15,
};

export interface FarmIntelligenceServiceOptions {
  appPool: pg.Pool;
}

export class FarmIntelligenceService {
  private readonly appPool: pg.Pool;

  constructor(options: FarmIntelligenceServiceOptions) {
    this.appPool = options.appPool;
  }

  async computeIndex(context: TenantContext, farmId?: Uuid): Promise<FarmIntelligenceIndex> {
    return this.read(context, async (client) => {
      const farmFilter = farmId ? "AND a.farm_id = $1" : "";
      const params = farmId ? [farmId] : [];

      const activeAnimals = Number(
        (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM animal a WHERE a.lifecycle_status = 'active' ${farmFilter}`, params)).rows[0]!.n,
      );
      const denom = Math.max(activeAnimals, 1);

      // 1. Identity & traceability completeness: active animals with an active RFID.
      const withRfid = Number(
        (
          await client.query<{ n: string }>(
            `SELECT count(DISTINCT a.id)::text AS n FROM animal a
             JOIN animal_identifier i ON i.animal_id = a.id AND i.identifier_type = 'rfid' AND i.valid_to IS NULL
             WHERE a.lifecycle_status = 'active' ${farmFilter}`,
            params,
          )
        ).rows[0]!.n,
      );

      // 2. Timely measurement: animals weighed within 60 days.
      const timely = Number(
        (
          await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM animal a
             WHERE a.lifecycle_status = 'active' ${farmFilter}
               AND EXISTS (SELECT 1 FROM animal_weight w WHERE w.animal_id = a.id AND w.eligible_for_analytics
                            AND w.occurred_at > now() - interval '60 days')`,
            params,
          )
        ).rows[0]!.n,
      );

      // 3. Reproduction control: active females with a service or check on record.
      const females = Number(
        (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM animal a WHERE a.lifecycle_status='active' AND a.sex='female' ${farmFilter}`, params)).rows[0]!.n,
      );
      const reproTracked = Number(
        (
          await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM animal a
             WHERE a.lifecycle_status='active' AND a.sex='female' ${farmFilter}
               AND (EXISTS (SELECT 1 FROM reproduction_service s WHERE s.dam_id = a.id)
                    OR EXISTS (SELECT 1 FROM pregnancy_check p WHERE p.dam_id = a.id))`,
            params,
          )
        ).rows[0]!.n,
      );

      // 4. Health compliance: fraction of active animals WITHOUT an open health alert.
      const openHealthAlerts = Number(
        (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM alert WHERE status <> 'resolved' AND alert_type IN ('withdrawal_active')`)).rows[0]!.n,
      );

      // 5. Pasture visibility: paddocks with an assessment in the last 45 days.
      const paddockFilter = farmId ? "WHERE p.farm_id = $1" : "";
      const paddocks = Number(
        (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM paddock p ${paddockFilter}`, params)).rows[0]!.n,
      );
      const assessedPaddocks = Number(
        (
          await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM paddock p
             ${farmId ? "WHERE p.farm_id = $1 AND" : "WHERE"}
               EXISTS (SELECT 1 FROM pasture_assessment pa WHERE pa.paddock_id = p.id AND pa.assessed_at > now() - interval '45 days')`,
            params,
          )
        ).rows[0]!.n,
      );

      // 6. Exception burden: fewer open alerts per animal is better.
      const openAlerts = Number(
        (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM alert WHERE status <> 'resolved'`)).rows[0]!.n,
      );

      const components: FiiComponent[] = [
        this.component("identity_traceability", withRfid / denom, { withRfid, activeAnimals }),
        this.component("timely_measurement", timely / denom, { timely, activeAnimals }),
        this.component("reproduction_control", females > 0 ? reproTracked / females : 1, { reproTracked, females }),
        this.component("health_compliance", Math.max(0, 1 - openHealthAlerts / denom), { openHealthAlerts, activeAnimals }),
        this.component("pasture_visibility", paddocks > 0 ? assessedPaddocks / paddocks : 1, { assessedPaddocks, paddocks }),
        this.component("exception_burden", Math.max(0, 1 - openAlerts / denom), { openAlerts, activeAnimals }),
      ];

      const totalWeight = components.reduce((s, c) => s + c.weight, 0);
      const score = totalWeight > 0 ? (100 * components.reduce((s, c) => s + c.weightedContribution, 0)) / totalWeight : 0;

      return {
        farmId: farmId ?? null,
        formulaVersion: FII_FORMULA_VERSION,
        score: Math.round(score * 10) / 10,
        components,
        calculatedAt: new Date().toISOString(),
      };
    });
  }

  async executiveDashboard(context: TenantContext, farmId?: Uuid): Promise<ExecutiveDashboard> {
    return this.read(context, async (client) => {
      const farmFilter = farmId ? "WHERE farm_id = $1" : "";
      const params = farmId ? [farmId] : [];

      const statusRows = await client.query<{ lifecycle_status: string; n: string }>(
        `SELECT lifecycle_status, count(*)::text AS n FROM animal ${farmFilter} GROUP BY lifecycle_status`,
        params,
      );
      const byStatus: Record<string, number> = {};
      for (const r of statusRows.rows) byStatus[r.lifecycle_status] = Number(r.n);

      const repro = await client.query<{ pregnant: string; served: string }>(
        `SELECT
           (SELECT count(*)::text FROM (
              SELECT DISTINCT ON (dam_id) result FROM pregnancy_check ORDER BY dam_id, check_date DESC
            ) latest WHERE latest.result = 'positive') AS pregnant,
           (SELECT count(DISTINCT dam_id)::text FROM reproduction_service) AS served`,
      );

      const restrictions = Number(
        (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM animal_restriction WHERE status='active' AND (valid_to IS NULL OR valid_to > now())`)).rows[0]!.n,
      );
      const openCases = Number(
        (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM health_case WHERE status='open'`)).rows[0]!.n,
      );

      const alertRows = await client.query<{ severity: string; n: string }>(
        `SELECT severity, count(*)::text AS n FROM alert WHERE status <> 'resolved' GROUP BY severity`,
      );
      const bySeverity: Record<string, number> = {};
      let openAlerts = 0;
      for (const r of alertRows.rows) {
        bySeverity[r.severity] = Number(r.n);
        openAlerts += Number(r.n);
      }

      const fii = await this.computeIndexInline(client, farmId);

      return {
        farmId: farmId ?? null,
        herd: { active: byStatus.active ?? 0, byStatus },
        reproduction: {
          pregnant: Number(repro.rows[0]?.pregnant ?? 0),
          served: Number(repro.rows[0]?.served ?? 0),
        },
        health: { activeRestrictions: restrictions, openCases },
        alerts: { open: openAlerts, bySeverity },
        farmIntelligenceIndex: fii,
        calculatedAt: new Date().toISOString(),
      };
    });
  }

  // -- internals --
  private component(domain: string, rawScore: number, detail: Record<string, unknown>): FiiComponent {
    const score = Math.min(1, Math.max(0, Number.isFinite(rawScore) ? rawScore : 0));
    const weight = WEIGHTS_V1[domain] ?? 0;
    return { domain, score: Math.round(score * 1000) / 1000, weight, weightedContribution: score * weight, detail };
  }

  private async computeIndexInline(client: pg.PoolClient, farmId?: Uuid): Promise<number> {
    // Lightweight FII for the dashboard: reuse traceability + timely + exception.
    const farmFilter = farmId ? "AND a.farm_id = $1" : "";
    const params = farmId ? [farmId] : [];
    const active = Number(
      (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM animal a WHERE a.lifecycle_status='active' ${farmFilter}`, params)).rows[0]!.n,
    );
    const denom = Math.max(active, 1);
    const withRfid = Number(
      (
        await client.query<{ n: string }>(
          `SELECT count(DISTINCT a.id)::text AS n FROM animal a
           JOIN animal_identifier i ON i.animal_id = a.id AND i.identifier_type='rfid' AND i.valid_to IS NULL
           WHERE a.lifecycle_status='active' ${farmFilter}`,
          params,
        )
      ).rows[0]!.n,
    );
    const openAlerts = Number(
      (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM alert WHERE status <> 'resolved'`)).rows[0]!.n,
    );
    const s = 0.6 * (withRfid / denom) + 0.4 * Math.max(0, 1 - openAlerts / denom);
    return Math.round(100 * s * 10) / 10;
  }

  private async read<T>(context: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide("read", context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new AnalyticsForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}
