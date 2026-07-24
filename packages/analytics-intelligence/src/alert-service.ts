import { NotFoundError, type TenantContext, type Uuid } from "@jk/domain-kernel";
import { withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { decide, loadCallerMemberships, type AnalyticsAction } from "./authorization.js";
import { AnalyticsForbiddenError } from "./errors.js";

/**
 * Alert generation and lifecycle (§26, JK-HLT-002, JK-REP-004). Alerts are
 * derived from current state, deduplicated by a stable key while unresolved,
 * severity-rated, and moved through open → acknowledged → resolved. Generation
 * is idempotent: re-running does not create duplicates.
 */

export interface GenerateOptions {
  farmId?: Uuid;
  nucleusCadenceDays?: number;
  beefCadenceDays?: number;
  calvingWindowDays?: number;
}

export interface GenerateResult {
  withdrawal: number;
  weighingOverdue: number;
  calvingDue: number;
  total: number;
}

export interface Alert {
  id: Uuid;
  alertType: string;
  severity: "info" | "warning" | "critical";
  message: string;
  animalId: Uuid | null;
  status: "open" | "acknowledged" | "resolved";
  evidence: Record<string, unknown>;
  createdAt: Date;
}

export interface AlertServiceOptions {
  appPool: pg.Pool;
}

export class AlertService {
  private readonly appPool: pg.Pool;

  constructor(options: AlertServiceOptions) {
    this.appPool = options.appPool;
  }

  /** Scan current state and raise any missing alerts (idempotent, deduped). */
  async generateAlerts(
    context: TenantContext,
    options: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const nucleus = options.nucleusCadenceDays ?? 30;
    const beef = options.beefCadenceDays ?? 60;
    const window = options.calvingWindowDays ?? 21;
    const farmId = options.farmId ?? null;

    return this.authorized(context, "manage_alerts", async (client) => {
      // (a) Active withdrawal restrictions (JK-HLT-005 evidence).
      const withdrawal = await client.query(
        `INSERT INTO alert (tenant_id, farm_id, animal_id, alert_type, severity, dedupe_key, message, evidence)
         SELECT $1, a.farm_id, r.animal_id, 'withdrawal_active', 'warning',
                'withdrawal:' || r.animal_id,
                'Restrição de carência ativa impede liberação para venda',
                jsonb_build_object('restrictionId', r.id, 'validUntil', r.valid_to)
         FROM animal_restriction r
         JOIN animal a ON a.id = r.animal_id
         WHERE r.status = 'active' AND r.restriction_type = 'withdrawal'
           AND (r.valid_to IS NULL OR r.valid_to > now())
           AND ($2::uuid IS NULL OR a.farm_id = $2)
         ON CONFLICT (tenant_id, dedupe_key) WHERE status <> 'resolved'
         DO NOTHING
         RETURNING id`,
        [context.tenantId, farmId],
      );

      // (b) Weighing overdue vs cadence (nucleus 30d, beef 60d; JK-WGT due rules).
      const weighing = await client.query(
        `INSERT INTO alert (tenant_id, farm_id, animal_id, alert_type, severity, dedupe_key, message, evidence)
         SELECT $1, a.farm_id, a.id, 'weighing_overdue', 'info',
                'weighing_overdue:' || a.id,
                'Pesagem em atraso para a cadência do lote',
                jsonb_build_object('lastWeightAt', lw.occurred_at)
         FROM animal a
         LEFT JOIN LATERAL (
           SELECT occurred_at FROM animal_weight w
           WHERE w.animal_id = a.id AND w.eligible_for_analytics = true
           ORDER BY occurred_at DESC LIMIT 1
         ) lw ON true
         LEFT JOIN LATERAL (
           SELECT l.purpose FROM lot_membership m
           JOIN lot l ON l.id = m.lot_id
           WHERE m.animal_id = a.id AND m.valid_to IS NULL LIMIT 1
         ) cl ON true
         WHERE a.lifecycle_status = 'active'
           AND ($2::uuid IS NULL OR a.farm_id = $2)
           AND (
             lw.occurred_at IS NULL
             OR lw.occurred_at < now() - ((CASE WHEN cl.purpose = 'genetic_nucleus' THEN $3::int ELSE $4::int END) * interval '1 day')
           )
         ON CONFLICT (tenant_id, dedupe_key) WHERE status <> 'resolved'
         DO NOTHING
         RETURNING id`,
        [context.tenantId, farmId, nucleus, beef],
      );

      // (c) Calving due within the window on the latest positive check, with
      // no calving recorded since (JK-REP-004).
      const calving = await client.query(
        `INSERT INTO alert (tenant_id, farm_id, animal_id, alert_type, severity, dedupe_key, message, evidence)
         SELECT $1, a.farm_id, pc.dam_id, 'calving_due', 'info',
                'calving_due:' || pc.dam_id,
                'Parto previsto dentro da janela de acompanhamento',
                jsonb_build_object('expectedCalvingDate', pc.expected_calving_date)
         FROM pregnancy_check pc
         JOIN animal a ON a.id = pc.dam_id
         WHERE pc.result = 'positive'
           AND pc.expected_calving_date IS NOT NULL
           AND pc.expected_calving_date <= (now() + ($3::int * interval '1 day'))::date
           AND ($2::uuid IS NULL OR a.farm_id = $2)
           AND pc.id = (SELECT id FROM pregnancy_check p2 WHERE p2.dam_id = pc.dam_id ORDER BY check_date DESC LIMIT 1)
           AND NOT EXISTS (SELECT 1 FROM calving c WHERE c.dam_id = pc.dam_id AND c.calving_date > pc.check_date)
         ON CONFLICT (tenant_id, dedupe_key) WHERE status <> 'resolved'
         DO NOTHING
         RETURNING id`,
        [context.tenantId, farmId, window],
      );

      return {
        withdrawal: withdrawal.rowCount ?? 0,
        weighingOverdue: weighing.rowCount ?? 0,
        calvingDue: calving.rowCount ?? 0,
        total:
          (withdrawal.rowCount ?? 0) + (weighing.rowCount ?? 0) + (calving.rowCount ?? 0),
      };
    });
  }

  async listAlerts(
    context: TenantContext,
    filter: { status?: string; severity?: string } = {},
  ): Promise<Alert[]> {
    return this.authorized(context, "read", async (client) => {
      const result = await client.query(
        `SELECT id, alert_type, severity, message, animal_id, status, evidence, created_at
         FROM alert
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::text IS NULL OR severity = $2)
         ORDER BY
           CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
           created_at DESC`,
        [filter.status ?? null, filter.severity ?? null],
      );
      return result.rows.map((r) => ({
        id: r.id,
        alertType: r.alert_type,
        severity: r.severity,
        message: r.message,
        animalId: r.animal_id,
        status: r.status,
        evidence: r.evidence,
        createdAt: r.created_at,
      }));
    });
  }

  async acknowledgeAlert(context: TenantContext, alertId: Uuid): Promise<void> {
    await this.transition(context, alertId, "acknowledged");
  }

  async resolveAlert(context: TenantContext, alertId: Uuid): Promise<void> {
    await this.transition(context, alertId, "resolved");
  }

  private async transition(
    context: TenantContext,
    alertId: Uuid,
    status: "acknowledged" | "resolved",
  ): Promise<void> {
    await this.authorized(context, "manage_alerts", async (client) => {
      const setResolved = status === "resolved" ? ", resolved_at = now()" : "";
      const setAck =
        status === "acknowledged"
          ? ", acknowledged_at = now(), acknowledged_by = " +
            (context.actor.type === "user" ? "$3" : "NULL")
          : "";
      const params: unknown[] = [alertId, status];
      if (status === "acknowledged" && context.actor.type === "user")
        params.push(context.actor.id);
      const result = await client.query(
        `UPDATE alert SET status = $2 ${setResolved} ${setAck} WHERE id = $1 RETURNING id`,
        params,
      );
      if (result.rows.length === 0) throw new NotFoundError(`Alert ${alertId} not found`);
    });
  }

  private async authorized<T>(
    context: TenantContext,
    action: AnalyticsAction,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide(action, context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok)
      throw new AnalyticsForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}
