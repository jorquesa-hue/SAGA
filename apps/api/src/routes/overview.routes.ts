import type { AlertService } from "@jk/analytics-intelligence";
import type { AssetsMaintenanceService } from "@jk/assets-maintenance";
import type { FinanceService } from "@jk/finance-commerce";
import type { HealthService } from "@jk/health-laboratory";
import type { LotsService, WeighingService } from "@jk/herd-operations";
import type { LandGrazingService } from "@jk/land-grazing";
import type { InventoryService } from "@jk/nutrition-inventory";
import type {
  GeneticsService,
  ReproductionGeneticsService,
} from "@jk/reproduction-genetics";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { buildTenantContext } from "../request-context.js";

/**
 * Tenant-scoped collection reads (§47).
 *
 * The command surfaces were built first, which left the console able to write
 * a treatment or a lot but not to see the ones already recorded. These are the
 * matching reads: one list per collection, each already joined to the names an
 * operator recognises so the client never has to resolve a UUID to show a row.
 *
 * Every handler delegates to its own module's service — the API composes, it
 * does not query another context's tables (module boundary, enforced by
 * `pnpm architecture:check`).
 */

export interface OverviewServices {
  lots: LotsService;
  weighing: WeighingService;
  health: HealthService;
  reproduction: ReproductionGeneticsService;
  genetics: GeneticsService;
  finance: FinanceService;
  land: LandGrazingService;
  inventory: InventoryService;
  assets: AssetsMaintenanceService;
  alerts: AlertService;
}

function tenant(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-tenant-id"];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Bounded, so a client cannot ask for the whole ledger by accident. */
function limit(request: FastifyRequest, fallback: number, max: number): number {
  const raw = (request.query as { limit?: string } | undefined)?.limit;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export function registerOverviewRoutes(
  app: FastifyInstance,
  services: OverviewServices,
): void {
  const ctx = (r: FastifyRequest) =>
    buildTenantContext(r.principal, tenant(r), r.correlationId);

  app.get("/api/v1/lots", async (r: FastifyRequest) => ({
    items: await services.lots.listLots(ctx(r)),
  }));

  app.get("/api/v1/handling-sessions", async (r: FastifyRequest) => ({
    items: await services.weighing.listSessions(ctx(r), limit(r, 25, 200)),
  }));

  app.get("/api/v1/weights", async (r: FastifyRequest) => ({
    items: await services.weighing.listRecentWeights(ctx(r), limit(r, 50, 500)),
  }));

  app.get("/api/v1/treatments", async (r: FastifyRequest) => ({
    items: await services.health.listTreatments(ctx(r), limit(r, 50, 500)),
  }));

  app.get("/api/v1/restrictions", async (r: FastifyRequest) => ({
    items: await services.health.listAllActiveRestrictions(ctx(r)),
  }));

  app.get("/api/v1/health-protocols", async (r: FastifyRequest) => ({
    items: await services.health.listProtocols(ctx(r)),
  }));

  app.get("/api/v1/health-cases", async (r: FastifyRequest) => ({
    items: await services.health.listCases(ctx(r), limit(r, 50, 200)),
  }));

  app.get("/api/v1/reproduction/events", async (r: FastifyRequest) => ({
    items: await services.reproduction.listReproductionEvents(ctx(r), limit(r, 60, 300)),
  }));

  app.get("/api/v1/genetics/evaluations", async (r: FastifyRequest) => ({
    items: await services.genetics.listEvaluations(ctx(r), limit(r, 40, 300)),
  }));

  app.get("/api/v1/finance/entries", async (r: FastifyRequest) => ({
    items: await services.finance.listEntries(ctx(r), limit(r, 60, 300)),
  }));

  app.get("/api/v1/finance/sales", async (r: FastifyRequest) => ({
    items: await services.finance.listSales(ctx(r), limit(r, 60, 300)),
  }));

  app.get("/api/v1/finance/budget-lines", async (r: FastifyRequest) => ({
    items: await services.finance.listBudgetLines(ctx(r), limit(r, 6, 36)),
  }));

  app.get("/api/v1/paddocks", async (r: FastifyRequest) => ({
    items: await services.land.listPaddocks(ctx(r)),
  }));

  app.get("/api/v1/inventory/items", async (r: FastifyRequest) => ({
    items: await services.inventory.listItems(ctx(r)),
  }));

  app.get("/api/v1/assets", async (r: FastifyRequest) => ({
    items: await services.assets.listAssets(ctx(r)),
  }));

  app.get("/api/v1/work-orders", async (r: FastifyRequest) => ({
    items: await services.assets.listWorkOrders(ctx(r), limit(r, 50, 200)),
  }));

  app.get("/api/v1/tasks", async (r: FastifyRequest) => ({
    items: await services.alerts.listTasks(ctx(r), limit(r, 60, 300)),
  }));
}
