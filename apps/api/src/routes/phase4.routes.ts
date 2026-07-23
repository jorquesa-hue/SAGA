import type { FarmIntelligenceService } from "@jk/analytics-intelligence";
import type { FinanceService } from "@jk/finance-commerce";
import type { GeneticsService } from "@jk/reproduction-genetics";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/** Phase 4 REST surface: finance, genetics, farm intelligence (§15.2, §22, §26, §60). */
function idem(request: FastifyRequest): string {
  const v = request.headers["idempotency-key"];
  const key = Array.isArray(v) ? v[0] : v;
  if (!key) throw new MissingHeaderError("Idempotency-Key header is required for this command");
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
): void {
  const ctx = (r: FastifyRequest) => buildTenantContext(r.principal, tenant(r), r.correlationId);

  // --- Finance ---
  app.post("/api/v1/finance/expenses", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const out = await finance.recordExpense(ctx(r), { ...(r.body as object), idempotencyKey: `exp:${key}` } as never);
    reply.status(201);
    return out;
  });
  app.post("/api/v1/finance/revenue", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const out = await finance.recordRevenue(ctx(r), { ...(r.body as object), idempotencyKey: `rev:${key}` } as never);
    reply.status(201);
    return out;
  });
  app.post("/api/v1/sales", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const out = await finance.recordSale(ctx(r), { ...(r.body as object), idempotencyKey: `sale:${key}` } as never);
    reply.status(201);
    return out;
  });
  app.get("/api/v1/lots/:lotId/margin", async (r: FastifyRequest) => {
    const { lotId } = r.params as { lotId: string };
    return finance.getMarginForLot(ctx(r), lotId);
  });
  app.post("/api/v1/finance/budgets", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    await finance.setBudget(ctx(r), (r.body ?? {}) as never);
    reply.status(204);
  });
  app.get("/api/v1/finance/budget-variance", async (r: FastifyRequest) => {
    const q = r.query as { periodMonth: string; category: string };
    return finance.getBudgetVariance(ctx(r), q.periodMonth, q.category);
  });

  // --- Genetics ---
  app.post("/api/v1/genetics/evaluations", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const out = await genetics.importEvaluation(ctx(r), { ...(r.body as object), idempotencyKey: `eval:${key}` } as never);
    reply.status(201);
    return out;
  });
  app.post("/api/v1/genetics/selection-indexes", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    const out = await genetics.defineSelectionIndex(ctx(r), (r.body ?? {}) as never);
    reply.status(201);
    return out;
  });
  app.post("/api/v1/genetics/selection-indexes/:indexId/rank", async (r: FastifyRequest) => {
    const { indexId } = r.params as { indexId: string };
    const body = (r.body ?? {}) as { animalIds?: string[] };
    return { items: await genetics.rankAnimals(ctx(r), indexId, body.animalIds ?? []) };
  });
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
