import type { HealthService } from "@jk/health-laboratory";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/** Health and Laboratory REST surface (§23, §47). */
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

export function registerHealthRoutes(app: FastifyInstance, service: HealthService): void {
  const ctx = (r: FastifyRequest) => buildTenantContext(r.principal, tenant(r), r.correlationId);

  app.post("/api/v1/animals/:animalId/treatments", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const { animalId } = r.params as { animalId: string };
    const body = (r.body ?? {}) as Record<string, unknown>;
    const treatment = await service.recordTreatment(ctx(r), {
      ...(body as object),
      animalId,
      idempotencyKey: `treatment:${key}`,
    } as never);
    reply.status(201);
    return treatment;
  });

  app.get("/api/v1/animals/:animalId/treatments", async (r: FastifyRequest) => {
    const { animalId } = r.params as { animalId: string };
    return { items: await service.getAnimalTreatments(ctx(r), animalId) };
  });

  app.get("/api/v1/animals/:animalId/restrictions", async (r: FastifyRequest) => {
    const { animalId } = r.params as { animalId: string };
    return { items: await service.listActiveRestrictions(ctx(r), animalId) };
  });

  app.get("/api/v1/animals/:animalId/sale-clear", async (r: FastifyRequest) => {
    const { animalId } = r.params as { animalId: string };
    return service.checkSaleClear(ctx(r), animalId);
  });

  app.post("/api/v1/restrictions/:restrictionId/override", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const { restrictionId } = r.params as { restrictionId: string };
    const body = (r.body ?? {}) as { reason?: string };
    const result = await service.overrideRestriction(ctx(r), {
      restrictionId,
      reason: body.reason as string,
      idempotencyKey: `override:${key}`,
    });
    reply.status(200);
    return result;
  });

  app.post("/api/v1/health-cases", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    const body = (r.body ?? {}) as Record<string, unknown>;
    const opened = await service.openCase(ctx(r), body as never);
    reply.status(201);
    return opened;
  });
}
