import type { AssetsMaintenanceService } from "@jk/assets-maintenance";
import type { LandGrazingService } from "@jk/land-grazing";
import type { InventoryService } from "@jk/nutrition-inventory";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/** Phase 3 REST surface: land/grazing, inventory, assets/maintenance (§15, §20, §25). */
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

export function registerPhase3Routes(
  app: FastifyInstance,
  land: LandGrazingService,
  inventory: InventoryService,
  assets: AssetsMaintenanceService,
): void {
  const ctx = (r: FastifyRequest) =>
    buildTenantContext(r.principal, tenant(r), r.correlationId);

  // --- Land & grazing ---
  app.post(
    "/api/v1/paddocks/:paddockId/assessments",
    async (r: FastifyRequest, reply: FastifyReply) => {
      idem(r);
      const { paddockId } = r.params as { paddockId: string };
      const body = (r.body ?? {}) as object;
      const a = await land.recordAssessment(ctx(r), { ...body, paddockId } as never);
      reply.status(201);
      return a;
    },
  );
  app.get("/api/v1/paddocks/:paddockId/grazing-metrics", async (r: FastifyRequest) => {
    const { paddockId } = r.params as { paddockId: string };
    return land.getGrazingMetrics(ctx(r), paddockId);
  });

  // --- Inventory ---
  app.post("/api/v1/inventory/items", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    const item = await inventory.createItem(ctx(r), (r.body ?? {}) as never);
    reply.status(201);
    return item;
  });
  app.post(
    "/api/v1/inventory/items/:itemId/receive",
    async (r: FastifyRequest, reply: FastifyReply) => {
      const key = idem(r);
      const { itemId } = r.params as { itemId: string };
      const body = (r.body ?? {}) as object;
      const result = await inventory.receiveStock(ctx(r), {
        ...body,
        itemId,
        idempotencyKey: `recv:${key}`,
      } as never);
      reply.status(201);
      return result;
    },
  );
  app.post(
    "/api/v1/inventory/items/:itemId/consume",
    async (r: FastifyRequest, reply: FastifyReply) => {
      const key = idem(r);
      const { itemId } = r.params as { itemId: string };
      const body = (r.body ?? {}) as object;
      const result = await inventory.consumeStock(ctx(r), {
        ...body,
        itemId,
        idempotencyKey: `cons:${key}`,
      } as never);
      reply.status(201);
      return result;
    },
  );
  app.get("/api/v1/inventory/items/:itemId/balance", async (r: FastifyRequest) => {
    const { itemId } = r.params as { itemId: string };
    return { itemId, balance: await inventory.getBalance(ctx(r), itemId) };
  });
  app.get("/api/v1/inventory/expiring-batches", async (r: FastifyRequest) => {
    const q = r.query as { withinDays?: string };
    return {
      items: await inventory.getExpiringBatches(
        ctx(r),
        q.withinDays ? Number(q.withinDays) : 30,
      ),
    };
  });

  // --- Assets & maintenance ---
  app.post("/api/v1/assets", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    const asset = await assets.registerAsset(ctx(r), (r.body ?? {}) as never);
    reply.status(201);
    return asset;
  });
  app.post(
    "/api/v1/assets/:assetId/schedules",
    async (r: FastifyRequest, reply: FastifyReply) => {
      idem(r);
      const { assetId } = r.params as { assetId: string };
      const body = (r.body ?? {}) as object;
      const s = await assets.defineSchedule(ctx(r), { ...body, assetId } as never);
      reply.status(201);
      return s;
    },
  );
  app.post(
    "/api/v1/assets/:assetId/calibration",
    async (r: FastifyRequest, reply: FastifyReply) => {
      idem(r);
      const { assetId } = r.params as { assetId: string };
      const body = (r.body ?? {}) as { validUntil?: string };
      await assets.recordCalibration(ctx(r), assetId, body.validUntil as string);
      reply.status(204);
    },
  );
  app.get("/api/v1/assets/:assetId/calibration-status", async (r: FastifyRequest) => {
    const { assetId } = r.params as { assetId: string };
    return assets.getCalibrationStatus(ctx(r), assetId);
  });
  app.post("/api/v1/work-orders", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    const wo = await assets.createWorkOrder(ctx(r), (r.body ?? {}) as never);
    reply.status(201);
    return wo;
  });
  app.post(
    "/api/v1/work-orders/:workOrderId/complete",
    async (r: FastifyRequest, reply: FastifyReply) => {
      idem(r);
      const { workOrderId } = r.params as { workOrderId: string };
      await assets.completeWorkOrder(ctx(r), workOrderId, (r.body ?? {}) as object);
      reply.status(204);
    },
  );
  app.get("/api/v1/maintenance/due", async (r: FastifyRequest) => {
    const q = r.query as { withinDays?: string };
    return {
      items: await assets.listDueMaintenance(
        ctx(r),
        q.withinDays ? Number(q.withinDays) : 0,
      ),
    };
  });
}
