import {
  ConflictError,
  createEventEnvelope,
  NotFoundError,
  PlatformError,
  ValidationError,
  newUuid,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import { appendEvent, withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { z } from "zod";

/**
 * Nutrition and Inventory service (JK-INV-001..005, §15.1). Inventory is
 * ledger-based: every receipt/consumption/adjustment/disposal is an immutable
 * stock movement, and balances are calculated as the signed sum. Negative
 * stock is prohibited by default; consumption links to animal/lot/paddock.
 */

export const STOCK_MOVEMENT_RECORDED = "inventory.stock_movement_recorded.v1";
const WRITE_ROLES = new Set([
  "tenant_owner",
  "farm_manager",
  "technician",
  "veterinarian",
]);

export class InventoryForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
}

export const createItemInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    category: z.enum(["feed", "mineral", "medicine", "tag", "consumable", "other"]),
    unit: z.string().trim().min(1).max(40),
    supplier: z.string().max(200).optional(),
    reorderLevel: z.number().nonnegative().optional(),
  })
  .strict();
export type CreateItemInput = z.input<typeof createItemInputSchema>;

export const receiveInputSchema = z
  .object({
    itemId: z.string().uuid(),
    quantity: z.number().positive(),
    batchCode: z.string().max(200).optional(),
    expirationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type ReceiveInput = z.input<typeof receiveInputSchema>;

export const consumeInputSchema = z
  .object({
    itemId: z.string().uuid(),
    quantity: z.number().positive(),
    batchId: z.string().uuid().optional(),
    animalId: z.string().uuid().optional(),
    lotId: z.string().uuid().optional(),
    paddockId: z.string().uuid().optional(),
    reason: z.string().max(500).optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type ConsumeInput = z.input<typeof consumeInputSchema>;

export interface Item {
  id: Uuid;
  name: string;
  category: string;
  unit: string;
  supplier: string | null;
  reorderLevel: number | null;
}

export interface InventoryServiceOptions {
  appPool: pg.Pool;
  environment?: string;
  /** Allow a documented negative-stock override (JK-INV: authorized exception). */
  allowNegativeOverride?: boolean;
}

/**
 * An item with its balance derived from the movement ledger rather than stored,
 * so the number can never disagree with the history that produced it.
 */
export interface ItemRow {
  id: Uuid;
  name: string;
  category: string;
  unit: string;
  supplier: string | null;
  reorderLevel: number | null;
  balance: number;
  /** True when the balance has fallen to or below the reorder level. */
  belowReorder: boolean;
  lastMovementAt: string | null;
  expiringBatches: number;
}

export class InventoryService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: InventoryServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  async createItem(context: TenantContext, rawInput: CreateItemInput): Promise<Item> {
    const input = this.parse(createItemInputSchema, rawInput);
    return this.authorized(context, true, async (client) => {
      try {
        const inserted = await client.query(
          `INSERT INTO item (tenant_id, name, category, unit, supplier, reorder_level)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, name, category, unit, supplier, reorder_level`,
          [
            context.tenantId,
            input.name,
            input.category,
            input.unit,
            input.supplier ?? null,
            input.reorderLevel ?? null,
          ],
        );
        const r = inserted.rows[0]!;
        return {
          id: r.id,
          name: r.name,
          category: r.category,
          unit: r.unit,
          supplier: r.supplier,
          reorderLevel: r.reorder_level === null ? null : Number(r.reorder_level),
        };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(`An item named '${input.name}' already exists`);
        }
        throw error;
      }
    });
  }

  async receiveStock(
    context: TenantContext,
    rawInput: ReceiveInput,
  ): Promise<{ movementId: Uuid; balance: number }> {
    const input = this.parse(receiveInputSchema, rawInput);
    return this.authorized(context, true, async (client) => {
      const item = await this.getItemUnit(client, input.itemId);
      let batchId: string | null = null;
      if (input.batchCode) {
        const batch = await client.query<{ id: string }>(
          `INSERT INTO item_batch (tenant_id, item_id, batch_code, expiration_date)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, item_id, batch_code) DO UPDATE SET expiration_date = EXCLUDED.expiration_date
           RETURNING id`,
          [context.tenantId, input.itemId, input.batchCode, input.expirationDate ?? null],
        );
        batchId = batch.rows[0]!.id;
      }
      const movementId = await this.insertMovement(client, context, {
        itemId: input.itemId,
        batchId,
        movementType: "receipt",
        quantityDelta: input.quantity,
        unit: item.unit,
        occurredAt: input.occurredAt,
        idempotencyKey: input.idempotencyKey,
      });
      const balance = await this.balance(client, input.itemId);
      return { movementId, balance };
    });
  }

  async consumeStock(
    context: TenantContext,
    rawInput: ConsumeInput,
  ): Promise<{ movementId: Uuid; balance: number }> {
    const input = this.parse(consumeInputSchema, rawInput);
    return this.authorized(context, true, async (client) => {
      const item = await this.getItemUnit(client, input.itemId);
      const current = await this.balance(client, input.itemId);
      if (current - input.quantity < 0) {
        // Negative stock prohibited by default (JK-INV-002/005).
        throw new ConflictError(
          `Insufficient stock for item ${input.itemId}: balance ${current}, requested ${input.quantity}`,
          "JK-INV-NEGATIVE-STOCK",
        );
      }
      const movementId = await this.insertMovement(client, context, {
        itemId: input.itemId,
        batchId: input.batchId ?? null,
        movementType: "consumption",
        quantityDelta: -input.quantity,
        unit: item.unit,
        animalId: input.animalId,
        lotId: input.lotId,
        paddockId: input.paddockId,
        reason: input.reason,
        occurredAt: input.occurredAt,
        idempotencyKey: input.idempotencyKey,
      });
      const balance = await this.balance(client, input.itemId);
      return { movementId, balance };
    });
  }

  async getBalance(context: TenantContext, itemId: Uuid): Promise<number> {
    return this.authorized(context, false, async (client) =>
      this.balance(client, itemId),
    );
  }

  /** Batches expiring on or before the given horizon (JK-INV-005). */
  async getExpiringBatches(
    context: TenantContext,
    withinDays = 30,
  ): Promise<Array<{ itemId: Uuid; batchCode: string; expirationDate: string }>> {
    return this.authorized(context, false, async (client) => {
      const result = await client.query(
        `SELECT item_id, batch_code, expiration_date::text AS expiration_date
         FROM item_batch
         WHERE expiration_date IS NOT NULL AND expiration_date <= (now() + ($1::int * interval '1 day'))::date
         ORDER BY expiration_date`,
        [withinDays],
      );
      return result.rows.map((r) => ({
        itemId: r.item_id,
        batchCode: r.batch_code,
        expirationDate: r.expiration_date,
      }));
    });
  }

  // -- internals --
  private async insertMovement(
    client: pg.PoolClient,
    context: TenantContext,
    m: {
      itemId: string;
      batchId: string | null;
      movementType: string;
      quantityDelta: number;
      unit: string;
      animalId?: string;
      lotId?: string;
      paddockId?: string;
      reason?: string;
      occurredAt?: string;
      idempotencyKey?: string;
    },
  ): Promise<Uuid> {
    const id = newUuid();
    // Append the event FIRST so event_id can be set at insert time: the
    // stock_movement ledger is append-only (trigger), so no post-insert
    // UPDATE is possible.
    const append = await appendEvent(
      client,
      createEventEnvelope({
        eventType: STOCK_MOVEMENT_RECORDED,
        context,
        aggregateType: "item",
        aggregateId: m.itemId,
        aggregateVersion: await this.nextVersion(client, context.tenantId, m.itemId),
        source: { channel: "api" },
        idempotencyKey: m.idempotencyKey ? `${m.idempotencyKey}:${id}` : `movement-${id}`,
        payload: {
          movementId: id,
          itemId: m.itemId,
          movementType: m.movementType,
          quantityDelta: m.quantityDelta,
          animalId: m.animalId ?? null,
          lotId: m.lotId ?? null,
        },
      }),
      { environment: this.environment },
    );
    await client.query(
      `INSERT INTO stock_movement
         (id, tenant_id, item_id, batch_id, movement_type, quantity_delta, unit,
          animal_id, lot_id, paddock_id, reason, occurred_at, event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12, now()), $13)`,
      [
        id,
        context.tenantId,
        m.itemId,
        m.batchId,
        m.movementType,
        m.quantityDelta,
        m.unit,
        m.animalId ?? null,
        m.lotId ?? null,
        m.paddockId ?? null,
        m.reason ?? null,
        m.occurredAt ?? null,
        append.eventId,
      ],
    );
    return id;
  }

  private async balance(client: pg.PoolClient, itemId: string): Promise<number> {
    const result = await client.query<{ balance: string }>(
      `SELECT COALESCE(SUM(quantity_delta), 0)::text AS balance FROM stock_movement WHERE item_id = $1`,
      [itemId],
    );
    return Number(result.rows[0]!.balance);
  }

  private async getItemUnit(
    client: pg.PoolClient,
    itemId: string,
  ): Promise<{ unit: string }> {
    const result = await client.query<{ unit: string }>(
      `SELECT unit FROM item WHERE id = $1`,
      [itemId],
    );
    if (result.rows.length === 0) throw new NotFoundError(`Item ${itemId} not found`);
    return result.rows[0]!;
  }

  private async nextVersion(
    client: pg.PoolClient,
    tenantId: string,
    itemId: string,
  ): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event WHERE tenant_id = $1 AND aggregate_type = 'item' AND aggregate_id = $2`,
      [tenantId, itemId],
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

  /** The item master with balances summed from the movement ledger. */
  async listItems(context: TenantContext): Promise<ItemRow[]> {
    return this.authorized(context, false, async (client) => {
      const result = await client.query<{
        id: string;
        name: string;
        category: string;
        unit: string;
        supplier: string | null;
        reorder_level: string | null;
        balance: string;
        last_movement_at: Date | null;
        expiring: string;
      }>(
        `SELECT i.id, i.name, i.category, i.unit, i.supplier, i.reorder_level,
                COALESCE((SELECT sum(m.quantity_delta) FROM stock_movement m
                           WHERE m.item_id = i.id), 0) AS balance,
                (SELECT max(m.occurred_at) FROM stock_movement m
                  WHERE m.item_id = i.id) AS last_movement_at,
                (SELECT count(*) FROM item_batch b
                  WHERE b.item_id = i.id
                    AND b.expiration_date IS NOT NULL
                    AND b.expiration_date <= (now() + interval '90 days')::date
                ) AS expiring
           FROM item i
          ORDER BY i.category, i.name`,
      );
      return result.rows.map((r) => {
        const balance = Number(r.balance);
        const reorder = r.reorder_level === null ? null : Number(r.reorder_level);
        return {
          id: r.id,
          name: r.name,
          category: r.category,
          unit: r.unit,
          supplier: r.supplier,
          reorderLevel: reorder,
          balance,
          belowReorder: reorder !== null && balance <= reorder,
          lastMovementAt: r.last_movement_at?.toISOString() ?? null,
          expiringBatches: Number(r.expiring),
        };
      });
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
        return { ok: false as const, reason: "role not permitted for inventory changes" };
      }
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new InventoryForbiddenError(outcome.reason);
    return outcome.value;
  }
}
