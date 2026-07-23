import type { LotsService } from "@jk/herd-operations";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/** Lots and movements REST surface (§20, §47). */
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

export function registerLotRoutes(app: FastifyInstance, service: LotsService): void {
  const ctx = (r: FastifyRequest) => buildTenantContext(r.principal, tenant(r), r.correlationId);

  app.post("/api/v1/lots", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const body = (r.body ?? {}) as object;
    const lot = await service.createLot(ctx(r), { ...body, idempotencyKey: `lot:${key}` } as never);
    reply.status(201);
    return lot;
  });

  app.post("/api/v1/lots/:lotId/animals", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    const { lotId } = r.params as { lotId: string };
    const body = (r.body ?? {}) as { animalIds?: string[]; effectiveAt?: string };
    const results = await service.addAnimals(ctx(r), {
      lotId,
      animalIds: body.animalIds ?? [],
      effectiveAt: body.effectiveAt,
    });
    reply.status(200);
    return { results };
  });

  app.post("/api/v1/lots/:lotId/animals/remove", async (r: FastifyRequest) => {
    idem(r);
    const { lotId } = r.params as { lotId: string };
    const body = (r.body ?? {}) as { animalIds?: string[]; effectiveAt?: string };
    const results = await service.removeAnimals(ctx(r), {
      lotId,
      animalIds: body.animalIds ?? [],
      effectiveAt: body.effectiveAt,
    });
    return { results };
  });

  app.post("/api/v1/lot-movements", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const body = (r.body ?? {}) as object;
    const result = await service.moveToPaddock(ctx(r), { ...body, idempotencyKey: `move:${key}` } as never);
    reply.status(201);
    return result;
  });

  app.get("/api/v1/lots/:lotId/members", async (r: FastifyRequest) => {
    const { lotId } = r.params as { lotId: string };
    return { items: await service.getLotMembers(ctx(r), lotId) };
  });

  app.get("/api/v1/lots/:lotId/current-paddock", async (r: FastifyRequest) => {
    const { lotId } = r.params as { lotId: string };
    return { paddockId: await service.getCurrentPaddock(ctx(r), lotId) };
  });
}
