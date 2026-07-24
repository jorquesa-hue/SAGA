import type { ReproductionGeneticsService } from "@jk/reproduction-genetics";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/** Reproduction and Genetics REST surface (§21, §47). */
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

export function registerReproductionRoutes(
  app: FastifyInstance,
  service: ReproductionGeneticsService,
): void {
  const ctx = (r: FastifyRequest) =>
    buildTenantContext(r.principal, tenant(r), r.correlationId);

  app.post(
    "/api/v1/reproduction/services",
    async (r: FastifyRequest, reply: FastifyReply) => {
      const key = idem(r);
      const body = (r.body ?? {}) as object;
      const svc = await service.recordService(ctx(r), {
        ...body,
        idempotencyKey: `service:${key}`,
      } as never);
      reply.status(201);
      return svc;
    },
  );

  app.post(
    "/api/v1/reproduction/pregnancy-checks",
    async (r: FastifyRequest, reply: FastifyReply) => {
      const key = idem(r);
      const body = (r.body ?? {}) as object;
      const check = await service.recordPregnancyCheck(ctx(r), {
        ...body,
        idempotencyKey: `pregcheck:${key}`,
      } as never);
      reply.status(201);
      return check;
    },
  );

  app.post("/api/v1/calvings", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const body = (r.body ?? {}) as object;
    const calving = await service.recordCalving(ctx(r), {
      ...body,
      idempotencyKey: `calving:${key}`,
    } as never);
    reply.status(201);
    return calving;
  });

  app.get("/api/v1/animals/:animalId/reproduction-status", async (r: FastifyRequest) => {
    const { animalId } = r.params as { animalId: string };
    return service.getReproductionStatus(ctx(r), animalId);
  });
}
