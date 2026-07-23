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
 * Assets and Maintenance service (JK-AST-001..005, §15.3, §25): asset register,
 * preventive/calibration schedules, work orders, and device calibration status
 * (linked to weighing/RFID reliability).
 */

export const ASSET_REGISTERED = "asset.registered.v1";
export const WORK_ORDER_OPENED = "asset.work_order_opened.v1";
export const WORK_ORDER_COMPLETED = "asset.work_order_completed.v1";
export const CALIBRATION_RECORDED = "asset.calibration_recorded.v1";

const WRITE_ROLES = new Set(["tenant_owner", "farm_manager", "technician"]);

export class AssetForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
}

export const registerAssetInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    assetType: z.enum([
      "scale", "rfid_reader", "gateway", "vehicle", "machinery",
      "pump", "fence", "water_system", "corral", "other",
    ]),
    farmId: z.string().uuid().optional(),
    model: z.string().max(200).optional(),
    serial: z.string().max(200).optional(),
    location: z.string().max(200).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type RegisterAssetInput = z.input<typeof registerAssetInputSchema>;

export const scheduleInputSchema = z
  .object({
    assetId: z.string().uuid(),
    kind: z.enum(["preventive", "calibration"]),
    intervalDays: z.number().int().positive(),
    firstDueAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type ScheduleInput = z.input<typeof scheduleInputSchema>;

export const workOrderInputSchema = z
  .object({
    assetId: z.string().uuid(),
    description: z.string().trim().min(1).max(1000),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type WorkOrderInput = z.input<typeof workOrderInputSchema>;

export interface Asset {
  id: Uuid;
  name: string;
  assetType: string;
  status: string;
  calibrationValidUntil: Date | null;
}

export interface AssetsServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

export class AssetsMaintenanceService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: AssetsServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  async registerAsset(context: TenantContext, rawInput: RegisterAssetInput): Promise<Asset> {
    const input = this.parse(registerAssetInputSchema, rawInput);
    return this.authorized(context, true, async (client) => {
      const inserted = await client.query(
        `INSERT INTO asset (tenant_id, farm_id, name, asset_type, model, serial, location)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, name, asset_type, status, calibration_valid_until`,
        [context.tenantId, input.farmId ?? null, input.name, input.assetType, input.model ?? null, input.serial ?? null, input.location ?? null],
      );
      const r = inserted.rows[0]!;
      await this.emit(client, context, ASSET_REGISTERED, r.id, input.idempotencyKey ?? `asset-${r.id}`, {
        assetId: r.id,
        assetType: input.assetType,
        name: input.name,
      });
      return { id: r.id, name: r.name, assetType: r.asset_type, status: r.status, calibrationValidUntil: r.calibration_valid_until };
    });
  }

  async defineSchedule(context: TenantContext, rawInput: ScheduleInput): Promise<{ scheduleId: Uuid; nextDueAt: Date }> {
    const input = this.parse(scheduleInputSchema, rawInput);
    return this.authorized(context, true, async (client) => {
      await this.assertAsset(client, input.assetId);
      const nextDue = input.firstDueAt
        ? new Date(input.firstDueAt)
        : new Date(Date.now() + input.intervalDays * 86_400_000);
      const inserted = await client.query(
        `INSERT INTO maintenance_schedule (tenant_id, asset_id, kind, interval_days, next_due_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, next_due_at`,
        [context.tenantId, input.assetId, input.kind, input.intervalDays, nextDue.toISOString()],
      );
      return { scheduleId: inserted.rows[0]!.id, nextDueAt: inserted.rows[0]!.next_due_at };
    });
  }

  async createWorkOrder(context: TenantContext, rawInput: WorkOrderInput): Promise<{ workOrderId: Uuid }> {
    const input = this.parse(workOrderInputSchema, rawInput);
    return this.authorized(context, true, async (client) => {
      await this.assertAsset(client, input.assetId);
      const inserted = await client.query(
        `INSERT INTO work_order (tenant_id, asset_id, priority, description, opened_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [context.tenantId, input.assetId, input.priority, input.description, context.actor.type === "user" ? context.actor.id : null],
      );
      const id = inserted.rows[0]!.id;
      await client.query(`UPDATE asset SET status = 'maintenance' WHERE id = $1 AND status = 'active'`, [input.assetId]);
      await this.emit(client, context, WORK_ORDER_OPENED, input.assetId, input.idempotencyKey ?? `wo-${id}`, {
        workOrderId: id,
        assetId: input.assetId,
        priority: input.priority,
      });
      return { workOrderId: id };
    });
  }

  async completeWorkOrder(
    context: TenantContext,
    workOrderId: Uuid,
    costs: { laborCost?: number; partsCost?: number; downtimeHours?: number } = {},
  ): Promise<void> {
    await this.authorized(context, true, async (client) => {
      const updated = await client.query<{ asset_id: string }>(
        `UPDATE work_order
         SET status = 'done', closed_at = now(), labor_cost = $2, parts_cost = $3, downtime_hours = $4
         WHERE id = $1 AND status <> 'done'
         RETURNING asset_id`,
        [workOrderId, costs.laborCost ?? null, costs.partsCost ?? null, costs.downtimeHours ?? null],
      );
      if (updated.rows.length === 0) throw new NotFoundError(`Open work order ${workOrderId} not found`);
      const assetId = updated.rows[0]!.asset_id;
      // Return the asset to active only if no other open work orders remain.
      await client.query(
        `UPDATE asset SET status = 'active'
         WHERE id = $1 AND NOT EXISTS (
           SELECT 1 FROM work_order w WHERE w.asset_id = $1 AND w.status IN ('open','in_progress')
         )`,
        [assetId],
      );
      await this.emit(client, context, WORK_ORDER_COMPLETED, assetId, `wo-complete-${workOrderId}`, {
        workOrderId,
        assetId,
      });
    });
  }

  /** Record a calibration and set the asset's validity window (JK-AST-004). */
  async recordCalibration(context: TenantContext, assetId: Uuid, validUntil: string): Promise<void> {
    await this.authorized(context, true, async (client) => {
      await this.assertAsset(client, assetId);
      await client.query(`UPDATE asset SET calibration_valid_until = $2 WHERE id = $1`, [assetId, validUntil]);
      await client.query(
        `UPDATE maintenance_schedule
         SET last_done_at = now(), next_due_at = now() + (interval_days * interval '1 day')
         WHERE asset_id = $1 AND kind = 'calibration'`,
        [assetId],
      );
      await this.emit(client, context, CALIBRATION_RECORDED, assetId, `calib-${assetId}-${validUntil}`, {
        assetId,
        validUntil,
      });
    });
  }

  /** Calibration status for a device (JK-AST-004, JK-WGT-007). */
  async getCalibrationStatus(
    context: TenantContext,
    assetId: Uuid,
  ): Promise<{ assetId: Uuid; valid: boolean; validUntil: Date | null }> {
    return this.authorized(context, false, async (client) => {
      const r = await client.query<{ calibration_valid_until: Date | null }>(
        `SELECT calibration_valid_until FROM asset WHERE id = $1`,
        [assetId],
      );
      if (r.rows.length === 0) throw new NotFoundError(`Asset ${assetId} not found`);
      const validUntil = r.rows[0]!.calibration_valid_until;
      return { assetId, valid: validUntil != null && validUntil.getTime() > Date.now(), validUntil };
    });
  }

  async listDueMaintenance(
    context: TenantContext,
    withinDays = 0,
  ): Promise<Array<{ assetId: Uuid; kind: string; nextDueAt: Date }>> {
    return this.authorized(context, false, async (client) => {
      const result = await client.query(
        `SELECT asset_id, kind, next_due_at FROM maintenance_schedule
         WHERE next_due_at <= now() + ($1::int * interval '1 day')
         ORDER BY next_due_at`,
        [withinDays],
      );
      return result.rows.map((r) => ({ assetId: r.asset_id, kind: r.kind, nextDueAt: r.next_due_at }));
    });
  }

  // -- internals --
  private async emit(
    client: pg.PoolClient,
    context: TenantContext,
    eventType: string,
    assetId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await appendEvent(
      client,
      createEventEnvelope({
        eventType,
        context,
        aggregateType: "asset",
        aggregateId: assetId,
        aggregateVersion: await this.nextVersion(client, context.tenantId, assetId),
        source: { channel: "api" },
        idempotencyKey,
        payload,
      }),
      { environment: this.environment },
    );
  }

  private async assertAsset(client: pg.PoolClient, assetId: string): Promise<void> {
    const r = await client.query(`SELECT 1 FROM asset WHERE id = $1`, [assetId]);
    if (r.rows.length === 0) throw new NotFoundError(`Asset ${assetId} not found`);
  }

  private async nextVersion(client: pg.PoolClient, tenantId: string, assetId: string): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event WHERE tenant_id = $1 AND aggregate_type = 'asset' AND aggregate_id = $2`,
      [tenantId, assetId],
    );
    return result.rows[0]!.next;
  }

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
      if (active.length === 0) return { ok: false as const, reason: "no_active_membership" };
      if (write && !active.some((m) => WRITE_ROLES.has(m.role))) {
        return { ok: false as const, reason: "role not permitted for asset changes" };
      }
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new AssetForbiddenError(outcome.reason);
    return outcome.value;
  }
}
