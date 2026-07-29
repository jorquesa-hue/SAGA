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
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("BRL"),
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
    deductions: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .default("0"),
    freight: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .default("0"),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("BRL"),
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
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("BRL"),
  })
  .strict();
export type BudgetInput = z.input<typeof budgetInputSchema>;

export interface FinanceServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

/**
 * A ledger line. Amounts stay in minor units all the way to the client —
 * money is never a float in this system (§55).
 */
export interface LedgerRow {
  id: Uuid;
  farmId: Uuid | null;
  farmName: string | null;
  entryType: "expense" | "revenue";
  category: string;
  counterparty: string | null;
  amountMinor: number;
  currency: string;
  capexOpex: string | null;
  /** Set when this entry compensates an earlier one (invariant 2). */
  reversesEntryId: Uuid | null;
  occurredAt: string;
  allocations: Array<{ dimension: string; targetId: Uuid | null; minor: number }>;
}

export interface SaleRow {
  id: Uuid;
  animalId: Uuid | null;
  visualId: string | null;
  lotId: Uuid | null;
  lotName: string | null;
  weightKg: number | null;
  priceBasis: string | null;
  grossMinor: number;
  deductionsMinor: number;
  freightMinor: number;
  netReceiptMinor: number;
  currency: string;
  soldAt: string;
}

/** A budget line beside what was actually booked against it. */
export interface BudgetLine {
  periodMonth: string;
  category: string;
  plannedMinor: number;
  actualMinor: number;
  currency: string;
}

export class FinanceService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: FinanceServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  async recordExpense(
    context: TenantContext,
    rawInput: RecordEntryInput,
  ): Promise<{ entryId: Uuid }> {
    return this.recordEntry(context, "expense", rawInput);
  }

  async recordRevenue(
    context: TenantContext,
    rawInput: RecordEntryInput,
  ): Promise<{ entryId: Uuid }> {
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
          await this.emit(
            client,
            context,
            entryType === "expense" ? EXPENSE_RECORDED : REVENUE_RECORDED,
            entryId,
            input.idempotencyKey ?? `entry-${entryId}`,
            {
              entryId,
              entryType,
              category: input.category,
              amount: money.toDecimal(),
              currency: input.currency,
            },
          ),
        ],
      );
      await this.writeAllocations(
        client,
        context,
        entryId,
        money,
        input.allocations,
        input.farmId,
      );
      return { entryId };
    });
  }

  /** Record an animal/lot sale: net = gross - deductions - freight; posts revenue. */
  async recordSale(
    context: TenantContext,
    rawInput: RecordSaleInput,
  ): Promise<{ saleId: Uuid; entryId: Uuid; netReceipt: string }> {
    const input = this.parse(recordSaleInputSchema, rawInput);
    const currency = input.currency;
    const gross = Money.fromDecimal(input.gross, currency);
    const deductions = Money.fromDecimal(input.deductions, currency);
    const freight = Money.fromDecimal(input.freight, currency);
    const net = gross.subtract(deductions).subtract(freight);
    if (net.isNegative()) {
      throw new ValidationError(
        "Net receipt cannot be negative (deductions + freight exceed gross)",
      );
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
          await this.emit(
            client,
            context,
            REVENUE_RECORDED,
            entryId,
            `sale-entry-${entryId}`,
            { entryId, category: "animal_sale" },
          ),
        ],
      );
      await client.query(
        `INSERT INTO financial_allocation (tenant_id, entry_id, dimension, target_id, allocated_minor, allocation_rule_version)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          context.tenantId,
          entryId,
          allocationDim,
          targetId,
          net.minorUnits.toString(),
          ALLOCATION_RULE_VERSION,
        ],
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
          await this.emit(
            client,
            context,
            SALE_RECORDED,
            saleId,
            input.idempotencyKey ?? `sale-${saleId}`,
            {
              saleId,
              animalId: input.animalId ?? null,
              lotId: input.lotId ?? null,
              netReceipt: net.toDecimal(),
            },
            "sale",
          ),
        ],
      );
      return { saleId, entryId, netReceipt: net.toDecimal() };
    });
  }

  /** Total allocated cost (expenses) for a dimension target (JK-FIN-003/006). */
  async getCostForTarget(
    context: TenantContext,
    dimension: Dimension,
    targetId: Uuid,
    currency = "BRL",
  ): Promise<string> {
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
  async getMarginForLot(
    context: TenantContext,
    lotId: Uuid,
    currency = "BRL",
  ): Promise<{ revenue: string; cost: string; margin: string }> {
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
      return {
        revenue: revenue.toDecimal(),
        cost: costM.toDecimal(),
        margin: revenue.subtract(costM).toDecimal(),
      };
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
        [
          context.tenantId,
          input.farmId ?? null,
          input.periodMonth,
          input.category,
          money.minorUnits.toString(),
          input.currency,
        ],
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
      return {
        planned: p.toDecimal(),
        actual: a.toDecimal(),
        variance: p.subtract(a).toDecimal(),
      };
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
        [
          context.tenantId,
          entryId,
          farmId ?? null,
          farmId ? null : "unallocated",
          money.minorUnits.toString(),
          ALLOCATION_RULE_VERSION,
        ],
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
        [
          context.tenantId,
          entryId,
          a.dimension,
          a.targetId ?? null,
          a.targetRef ?? null,
          parts[i]!.minorUnits.toString(),
          ALLOCATION_RULE_VERSION,
        ],
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

  /** The ledger, newest first, with each entry's allocations attached. */
  async listEntries(context: TenantContext, limit = 60): Promise<LedgerRow[]> {
    return this.authorized(context, async (client) => {
      const result = await client.query<{
        id: string;
        farm_id: string | null;
        farm_name: string | null;
        entry_type: "expense" | "revenue";
        category: string;
        counterparty: string | null;
        amount_minor: string;
        currency: string;
        capex_opex: string | null;
        reverses_entry_id: string | null;
        occurred_at: Date;
        allocations: Array<{ dimension: string; targetId: string | null; minor: number }>;
      }>(
        `SELECT e.id, e.farm_id, f.name AS farm_name, e.entry_type, e.category,
                e.counterparty, e.amount_minor, e.currency, e.capex_opex,
                e.reverses_entry_id, e.occurred_at,
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'dimension', a.dimension,
                           'targetId', a.target_id,
                           'minor', a.allocated_minor))
                    FROM financial_allocation a WHERE a.entry_id = e.id
                ), '[]'::json) AS allocations
           FROM financial_entry e
           LEFT JOIN farm f ON f.id = e.farm_id
          ORDER BY e.occurred_at DESC, e.id
          LIMIT $1`,
        [Math.min(Math.max(limit, 1), 300)],
      );
      return result.rows.map((r) => ({
        id: r.id,
        farmId: r.farm_id,
        farmName: r.farm_name,
        entryType: r.entry_type,
        category: r.category,
        counterparty: r.counterparty,
        amountMinor: Number(r.amount_minor),
        currency: r.currency.trim(),
        capexOpex: r.capex_opex,
        reversesEntryId: r.reverses_entry_id,
        occurredAt: r.occurred_at.toISOString(),
        allocations: r.allocations.map((a) => ({
          dimension: a.dimension,
          targetId: a.targetId,
          minor: Number(a.minor),
        })),
      }));
    });
  }

  /** Sales, newest first, with the animal and lot resolved. */
  async listSales(context: TenantContext, limit = 60): Promise<SaleRow[]> {
    return this.authorized(context, async (client) => {
      const result = await client.query<{
        id: string;
        animal_id: string | null;
        visual_id: string | null;
        lot_id: string | null;
        lot_name: string | null;
        weight_kg: string | null;
        price_basis: string | null;
        gross_minor: string;
        deductions_minor: string;
        freight_minor: string;
        net_receipt_minor: string;
        currency: string;
        sold_at: Date;
      }>(
        `SELECT s.id, s.animal_id, a.visual_id, s.lot_id, l.name AS lot_name,
                s.weight_kg, s.price_basis, s.gross_minor, s.deductions_minor,
                s.freight_minor, s.net_receipt_minor, s.currency, s.sold_at
           FROM sale s
           LEFT JOIN animal a ON a.id = s.animal_id
           LEFT JOIN lot l ON l.id = s.lot_id
          ORDER BY s.sold_at DESC, a.visual_id
          LIMIT $1`,
        [Math.min(Math.max(limit, 1), 300)],
      );
      return result.rows.map((r) => ({
        id: r.id,
        animalId: r.animal_id,
        visualId: r.visual_id,
        lotId: r.lot_id,
        lotName: r.lot_name,
        weightKg: r.weight_kg === null ? null : Number(r.weight_kg),
        priceBasis: r.price_basis,
        grossMinor: Number(r.gross_minor),
        deductionsMinor: Number(r.deductions_minor),
        freightMinor: Number(r.freight_minor),
        netReceiptMinor: Number(r.net_receipt_minor),
        currency: r.currency.trim(),
        soldAt: r.sold_at.toISOString(),
      }));
    });
  }

  /**
   * Plan beside actual, per month and category. A category with a plan and no
   * spend still returns a row — an untouched budget line is information.
   */
  async listBudgetLines(context: TenantContext, months = 6): Promise<BudgetLine[]> {
    return this.authorized(context, async (client) => {
      const result = await client.query<{
        period_month: Date;
        category: string;
        planned_minor: string;
        actual_minor: string;
        currency: string;
      }>(
        `WITH periods AS (
           SELECT DISTINCT period_month FROM budget
            ORDER BY period_month DESC LIMIT $1
         )
         SELECT b.period_month, b.category, sum(b.planned_minor) AS planned_minor,
                COALESCE((
                  SELECT sum(e.amount_minor) FROM financial_entry e
                   WHERE e.category = b.category
                     AND date_trunc('month', e.occurred_at)::date = b.period_month
                     AND e.reverses_entry_id IS NULL
                ), 0) AS actual_minor,
                min(b.currency) AS currency
           FROM budget b
          WHERE b.period_month IN (SELECT period_month FROM periods)
          GROUP BY b.period_month, b.category
          ORDER BY b.period_month DESC, b.category`,
        [Math.min(Math.max(months, 1), 36)],
      );
      return result.rows.map((r) => ({
        periodMonth: r.period_month.toISOString().slice(0, 10),
        category: r.category,
        plannedMinor: Number(r.planned_minor),
        actualMinor: Number(r.actual_minor),
        currency: r.currency.trim(),
      }));
    });
  }

  private async authorized<T>(
    context: TenantContext,
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
      if (!active.some((m) => FINANCE_ROLES.has(m.role))) {
        return {
          ok: false as const,
          reason: `role not permitted for finance; requires one of ${[...FINANCE_ROLES].join(", ")}`,
        };
      }
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new FinanceForbiddenError(outcome.reason);
    return outcome.value;
  }
}
