import type { FarmIntelligenceService } from "@jk/analytics-intelligence";
import type { FinanceService } from "@jk/finance-commerce";
import type { IdentityService } from "@jk/identity-tenancy";
import type { GeneticsService } from "@jk/reproduction-genetics";
import type { TenantContext } from "@jk/domain-kernel";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CurrencyMismatchError, MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/** Phase 4 REST surface: finance, genetics, farm intelligence (§15.2, §22, §26, §60). */
function idem(request: FastifyRequest): string {
  const v = request.headers["idempotency-key"];
  const key = Array.isArray(v) ? v[0] : v;
  if (!key)
    throw new MissingHeaderError("Idempotency-Key header is required for this command");
  return key;
}
function tenant(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-tenant-id"];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function registerPhase4Routes(
  app: FastifyInstance,
  finance: FinanceService,
  genetics: GeneticsService,
  farmIntelligence: FarmIntelligenceService,
  identity: IdentityService,
): void {
  const ctx = (r: FastifyRequest) =>
    buildTenantContext(r.principal, tenant(r), r.correlationId);

  /** The tenant's base currency — money is recorded and reported in it. */
  const baseCurrency = async (context: TenantContext): Promise<string> =>
    (await identity.getTenant(context)).defaultCurrency;

  /**
   * Money writes are single-currency: the amount is recorded in the tenant's
   * base currency. A body that names a different currency is rejected (no FX);
   * an absent currency is filled in with the base so the row is explicit.
   */
  const withBaseCurrency = (
    body: Record<string, unknown>,
    base: string,
  ): Record<string, unknown> => {
    const provided = body.currency;
    if (typeof provided === "string" && provided.toUpperCase() !== base) {
      throw new CurrencyMismatchError(
        `Amount currency '${provided}' does not match the tenant base currency '${base}'`,
      );
    }
    return { ...body, currency: base };
  };

  // --- Finance ---
  app.post("/api/v1/finance/expenses", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const context = ctx(r);
    const body = withBaseCurrency(
      (r.body ?? {}) as Record<string, unknown>,
      await baseCurrency(context),
    );
    const out = await finance.recordExpense(context, {
      ...body,
      idempotencyKey: `exp:${key}`,
    } as never);
    reply.status(201);
    return out;
  });
  app.post("/api/v1/finance/revenue", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const context = ctx(r);
    const body = withBaseCurrency(
      (r.body ?? {}) as Record<string, unknown>,
      await baseCurrency(context),
    );
    const out = await finance.recordRevenue(context, {
      ...body,
      idempotencyKey: `rev:${key}`,
    } as never);
    reply.status(201);
    return out;
  });
  app.post("/api/v1/sales", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const context = ctx(r);
    const body = withBaseCurrency(
      (r.body ?? {}) as Record<string, unknown>,
      await baseCurrency(context),
    );
    const out = await finance.recordSale(context, {
      ...body,
      idempotencyKey: `sale:${key}`,
    } as never);
    reply.status(201);
    return out;
  });
  app.get("/api/v1/lots/:lotId/margin", async (r: FastifyRequest) => {
    const { lotId } = r.params as { lotId: string };
    const context = ctx(r);
    const currency = await baseCurrency(context);
    const margin = await finance.getMarginForLot(context, lotId, currency);
    return { ...margin, currency };
  });
  app.post("/api/v1/finance/budgets", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    const context = ctx(r);
    const body = withBaseCurrency(
      (r.body ?? {}) as Record<string, unknown>,
      await baseCurrency(context),
    );
    await finance.setBudget(context, body as never);
    reply.status(204);
  });
  app.get("/api/v1/finance/budget-variance", async (r: FastifyRequest) => {
    const q = r.query as { periodMonth: string; category: string };
    const context = ctx(r);
    const currency = await baseCurrency(context);
    const variance = await finance.getBudgetVariance(
      context,
      q.periodMonth,
      q.category,
      currency,
    );
    return { ...variance, currency };
  });

  // --- Genetics ---
  app.post(
    "/api/v1/genetics/evaluations",
    async (r: FastifyRequest, reply: FastifyReply) => {
      const key = idem(r);
      const out = await genetics.importEvaluation(ctx(r), {
        ...(r.body as object),
        idempotencyKey: `eval:${key}`,
      } as never);
      reply.status(201);
      return out;
    },
  );
  app.post(
    "/api/v1/genetics/selection-indexes",
    async (r: FastifyRequest, reply: FastifyReply) => {
      idem(r);
      const out = await genetics.defineSelectionIndex(ctx(r), (r.body ?? {}) as never);
      reply.status(201);
      return out;
    },
  );
  app.post(
    "/api/v1/genetics/selection-indexes/:indexId/rank",
    async (r: FastifyRequest) => {
      const { indexId } = r.params as { indexId: string };
      const body = (r.body ?? {}) as { animalIds?: string[] };
      return { items: await genetics.rankAnimals(ctx(r), indexId, body.animalIds ?? []) };
    },
  );
  app.get("/api/v1/genetics/progress", async (r: FastifyRequest) => {
    const q = r.query as { trait: string };
    return { items: await genetics.geneticProgress(ctx(r), q.trait) };
  });

  // --- Farm intelligence & dashboard ---
  app.get("/api/v1/reports/farm-intelligence-index", async (r: FastifyRequest) => {
    const q = r.query as { farmId?: string };
    return farmIntelligence.computeIndex(ctx(r), q.farmId);
  });
  app.get("/api/v1/dashboards/executive", async (r: FastifyRequest) => {
    const q = r.query as { farmId?: string };
    return farmIntelligence.executiveDashboard(ctx(r), q.farmId);
  });
}
