import {
  createEventEnvelope,
  Money,
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
 * Finance and Commerce service (JK-FIN-001..007, JK-DOM-008, §15.2). An
 * operational subledger: expenses and revenue are immutable entries with a
 * currency and original amount; split allocation across dimensions is lossless
 * (largest-remainder via the Money value object) and versioned; sales compute
 * a net receipt and post revenue; cost and margin are summed per dimension.
 */

export const EXPENSE_RECORDED = "finance.expense_recorded.v1";
export const REVENUE_RECORDED = "finance.revenue_recorded.v1";
export const SALE_RECORDED = "finance.sale_recorded.v1";

const FINANCE_ROLES = new Set(["tenant_owner", "finance_user", "farm_manager"]);
export const ALLOCATION_RULE_VERSION = "v1";

export class FinanceForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
}

export type Dimension = "farm" | "paddock" | "lot" | "animal" | "asset" | "project";

const allocationSchema = z.object({
  dimension: z.enum(["farm", "paddock", "lot", "animal", "asset", "project"]),
  targetId: z.string().uuid().optional(),
  targetRef: z.string().max(200).optional(),
  weight: z.number().positive().default(1),
});

export const recordEntryInputSchema = z
  .object({
    category: z.string().trim().min(1).max(120),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "amount must be a decimal string"),
    currency: z.string().regex(/^[A-Z]{3}$/).default("BRL"),
    counterparty: z.string().max(200).optional(),
    capexOpex: z.enum(["capex", "opex"]).optional(),
    farmId: z.string().uuid().optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    allocations: z.array(allocationSchema).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type RecordEntryInput = z.input<typeof recordEntryInputSchema>;

export const recordSaleInputSchema = z
  .object({
    animalId: z.string().uuid().optional(),
    lotId: z.string().uuid().optional(),
    weightKg: z.number().positive().optional(),
    priceBasis: z.string().max(120).optional(),
    gross: z.string().regex(/^\d+(\.\d{1,2})?$/),
    deductions: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
    freight: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
    currency: z.string().regex(/^[A-Z]{3}$/).default("BRL"),
    soldAt: z.string().datetime({ offset: true }).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((v) => v.animalId || v.lotId, { message: "animalId or lotId is required" });
export type RecordSaleInput = z.input<typeof recordSaleInputSchema>;

export const budgetInputSchema = z
  .object({
    farmId: z.string().uuid().optional(),
    periodMonth: z.string().regex(/^\d{4}-\d{2}$/, "periodMonth must be YYYY-MM"),
    category: z.string().min(1).max(120),
    planned: z.string().regex(/^\d+(\.\d{1,2})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/).default("BRL"),
  })
  .strict();
export type BudgetInput = z.input<typeof budgetInputSchema>;

export interface FinanceServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

export class FinanceService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: FinanceServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  async recordExpense(context: TenantContext, rawInput: RecordEntryInput): Promise<{ entryId: Uuid }> {
    return this.recordEntry(context, "expense", rawInput);
  }

  async recordRevenue(context: TenantContext, rawInput: RecordEntryInput): Promise<{ entryId: Uuid }> {
    return this.recordEntry(context, "revenue", rawInput);
  }

  private async recordEntry(
    context: TenantContext,
    entryType: "expense" | "revenue",
    rawInput: RecordEntryInput,
  ): Promise<{ entryId: Uuid }> {
    const input = this.parse(recordEntryInputSchema, rawInput);
    const money = Money.fromDecimal(input.amount, input.currency);
    return this.authorized(context, async (client) => {
      const entryId = newUuid();
      await client.query(
        `INSERT INTO financial_entry
           (id, tenant_id, farm_id, entry_type, category, counterparty, amount_minor, currency, capex_opex, occurred_at, event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now()), $11)`,
        [
          entryId,
          context.tenantId,
          input.farmId ?? null,
          entryType,
          input.category,
          input.counterparty ?? null,
          money.minorUnits.toString(),
          input.currency,
          input.capexOpex ?? null,
          input.occurredAt ?? null,
          await this.emit(client, context, entryType === "expense" ? EXPENSE_RECORDED : REVENUE_RECORDED, entryId, input.idempotencyKey ?? `entry-${entryId}`, {
            entryId,
            entryType,
            category: input.category,
            amount: money.toDecimal(),
            currency: input.currency,
          }),
        ],
      );
      await this.writeAllocations(client, context, entryId, money, input.allocations, input.farmId);
      return { entryId };
    });
  }

  /** Record an animal/lot sale: net = gross - deductions - freight; posts revenue. */
  async recordSale(context: TenantContext, rawInput: RecordSaleInput): Promise<{ saleId: Uuid; entryId: Uuid; netReceipt: string }> {
    const input = this.parse(recordSaleInputSchema, rawInput);
    const currency = input.currency;
    const gross = Money.fromDecimal(input.gross, currency);
    const deductions = Money.fromDecimal(input.deductions, currency);
    const freight = Money.fromDecimal(input.freight, currency);
    const net = gross.subtract(deductions).subtract(freight);
    if (net.isNegative()) {
      throw new ValidationError("Net receipt cannot be negative (deductions + freight exceed gross)");
    }
    return this.authorized(context, async (client) => {
      // Post the revenue entry allocated to the animal or lot.
      const entryId = newUuid();
      const allocationDim: Dimension = input.animalId ? "animal" : "lot";
      const targetId = input.animalId ?? input.lotId!;
      await client.query(
        `INSERT INTO financial_entry
           (id, tenant_id, entry_type, category, amount_minor, currency, occurred_at, event_id)
         VALUES ($1,$2,'revenue','animal_sale',$3,$4, COALESCE($5, now()), $6)`,
        [
          entryId,
          context.tenantId,
          net.minorUnits.toString(),
          currency,
          input.soldAt ?? null,
          await this.emit(client, context, REVENUE_RECORDED, entryId, `sale-entry-${entryId}`, { entryId, category: "animal_sale" }),
        ],
      );
      await client.query(
        `INSERT INTO financial_allocation (tenant_id, entry_id, dimension, target_id, allocated_minor, allocation_rule_version)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [context.tenantId, entryId, allocationDim, targetId, net.minorUnits.toString(), ALLOCATION_RULE_VERSION],
      );

      const saleId = newUuid();
      await client.query(
        `INSERT INTO sale
           (id, tenant_id, entry_id, animal_id, lot_id, weight_kg, price_basis, gross_minor, deductions_minor, freight_minor, net_receipt_minor, currency, sold_at, event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13, now()), $14)`,
        [
          saleId,
          context.tenantId,
          entryId,
          input.animalId ?? null,
          input.lotId ?? null,
          input.weightKg ?? null,
          input.priceBasis ?? null,
          gross.minorUnits.toString(),
          deductions.minorUnits.toString(),
          freight.minorUnits.toString(),
          net.minorUnits.toString(),
          currency,
          input.soldAt ?? null,
          await this.emit(client, context, SALE_RECORDED, saleId, input.idempotencyKey ?? `sale-${saleId}`, {
            saleId,
            animalId: input.animalId ?? null,
            lotId: input.lotId ?? null,
            netReceipt: net.toDecimal(),
          }, "sale"),
        ],
      );
      return { saleId, entryId, netReceipt: net.toDecimal() };
    });
  }

  /** Total allocated cost (expenses) for a dimension target (JK-FIN-003/006). */
  async getCostForTarget(context: TenantContext, dimension: Dimension, targetId: Uuid, currency = "BRL"): Promise<string> {
    return this.authorized(context, async (client) => {
      const result = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(al.allocated_minor), 0)::text AS total
         FROM financial_allocation al
         JOIN financial_entry e ON e.id = al.entry_id AND e.entry_type = 'expense'
         WHERE al.dimension = $1 AND al.target_id = $2`,
        [dimension, targetId],
      );
      return Money.fromMinorUnits(BigInt(result.rows[0]!.total), currency).toDecimal();
    });
  }

  /** Margin for a lot = revenue allocated to it minus expense allocated to it. */
  async getMarginForLot(context: TenantContext, lotId: Uuid, currency = "BRL"): Promise<{ revenue: string; cost: string; margin: string }> {
    return this.authorized(context, async (client) => {
      const rev = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(al.allocated_minor), 0)::text AS total
         FROM financial_allocation al
         JOIN financial_entry e ON e.id = al.entry_id AND e.entry_type = 'revenue'
         WHERE al.dimension = 'lot' AND al.target_id = $1`,
        [lotId],
      );
      const cost = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(al.allocated_minor), 0)::text AS total
         FROM financial_allocation al
         JOIN financial_entry e ON e.id = al.entry_id AND e.entry_type = 'expense'
         WHERE al.dimension = 'lot' AND al.target_id = $1`,
        [lotId],
      );
      const revenue = Money.fromMinorUnits(BigInt(rev.rows[0]!.total), currency);
      const costM = Money.fromMinorUnits(BigInt(cost.rows[0]!.total), currency);
      return { revenue: revenue.toDecimal(), cost: costM.toDecimal(), margin: revenue.subtract(costM).toDecimal() };
    });
  }

  async setBudget(context: TenantContext, rawInput: BudgetInput): Promise<void> {
    const input = this.parse(budgetInputSchema, rawInput);
    const money = Money.fromDecimal(input.planned, input.currency);
    await this.authorized(context, async (client) => {
      await client.query(
        `INSERT INTO budget (tenant_id, farm_id, period_month, category, planned_minor, currency)
         VALUES ($1,$2, ($3 || '-01')::date, $4, $5, $6)
         ON CONFLICT (tenant_id, farm_id, period_month, category)
         DO UPDATE SET planned_minor = EXCLUDED.planned_minor`,
        [context.tenantId, input.farmId ?? null, input.periodMonth, input.category, money.minorUnits.toString(), input.currency],
      );
    });
  }

  async getBudgetVariance(
    context: TenantContext,
    periodMonth: string,
    category: string,
    currency = "BRL",
  ): Promise<{ planned: string; actual: string; variance: string }> {
    return this.authorized(context, async (client) => {
      const planned = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(planned_minor), 0)::text AS total FROM budget
         WHERE period_month = ($1 || '-01')::date AND category = $2`,
        [periodMonth, category],
      );
      const actual = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_minor), 0)::text AS total FROM financial_entry
         WHERE entry_type = 'expense' AND category = $2
           AND date_trunc('month', occurred_at) = ($1 || '-01')::date`,
        [periodMonth, category],
      );
      const p = Money.fromMinorUnits(BigInt(planned.rows[0]!.total), currency);
      const a = Money.fromMinorUnits(BigInt(actual.rows[0]!.total), currency);
      return { planned: p.toDecimal(), actual: a.toDecimal(), variance: p.subtract(a).toDecimal() };
    });
  }

  // -- internals --
  private async writeAllocations(
    client: pg.PoolClient,
    context: TenantContext,
    entryId: Uuid,
    money: Money,
    allocations: Array<z.infer<typeof allocationSchema>> | undefined,
    farmId: string | undefined,
  ): Promise<void> {
    if (!allocations || allocations.length === 0) {
      // Default: allocate the whole amount to the farm (or unallocated).
      await client.query(
        `INSERT INTO financial_allocation (tenant_id, entry_id, dimension, target_id, target_ref, allocated_minor, allocation_rule_version)
         VALUES ($1,$2,'farm',$3,$4,$5,$6)`,
        [context.tenantId, entryId, farmId ?? null, farmId ? null : "unallocated", money.minorUnits.toString(), ALLOCATION_RULE_VERSION],
      );
      return;
    }
    // Lossless split by weights (largest-remainder, JK-FIN-002).
    const parts = money.allocate(allocations.map((a) => a.weight ?? 1));
    for (let i = 0; i < allocations.length; i += 1) {
      const a = allocations[i]!;
      await client.query(
        `INSERT INTO financial_allocation (tenant_id, entry_id, dimension, target_id, target_ref, allocated_minor, allocation_rule_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [context.tenantId, entryId, a.dimension, a.targetId ?? null, a.targetRef ?? null, parts[i]!.minorUnits.toString(), ALLOCATION_RULE_VERSION],
      );
    }
  }

  private async emit(
    client: pg.PoolClient,
    context: TenantContext,
    eventType: string,
    aggregateId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>,
    aggregateType = "financial_entry",
  ): Promise<string> {
    const append = await appendEvent(
      client,
      createEventEnvelope({
        eventType,
        context,
        aggregateType,
        aggregateId,
        aggregateVersion: 1,
        source: { channel: "api" },
        idempotencyKey,
        payload,
      }),
      { environment: this.environment },
    );
    return append.eventId;
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

  private async authorized<T>(context: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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
      if (!active.some((m) => FINANCE_ROLES.has(m.role))) {
        return { ok: false as const, reason: `role not permitted for finance; requires one of ${[...FINANCE_ROLES].join(", ")}` };
      }
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new FinanceForbiddenError(outcome.reason);
    return outcome.value;
  }
}
