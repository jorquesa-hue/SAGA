import type { WeighingService } from "@jk/herd-operations";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/**
 * Herd Operations REST surface (§19, §47): handling sessions, weight capture,
 * device-observation batch ingestion (partial success), exceptions, weights,
 * and ADG.
 */

function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  const value = Array.isArray(key) ? key[0] : key;
  if (!value) throw new MissingHeaderError("Idempotency-Key header is required for this command");
  return value;
}

function tenantHeader(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-tenant-id"];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function registerHerdRoutes(app: FastifyInstance, service: WeighingService): void {
  const ctx = (request: FastifyRequest) =>
    buildTenantContext(request.principal, tenantHeader(request), request.correlationId);

  app.post("/api/v1/handling-sessions", async (request: FastifyRequest, reply: FastifyReply) => {
    const key = idempotencyKey(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const session = await service.startSession(ctx(request), {
      farmId: body.farmId as string,
      purpose: body.purpose as never,
      deviceId: body.deviceId as string | undefined,
      expectedCount: body.expectedCount as number | undefined,
      idempotencyKey: `session-start:${key}`,
    });
    reply.status(201);
    return session;
  });

  app.post("/api/v1/handling-sessions/:sessionId/observations", async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await service.recordObservation(ctx(request), {
      ...(body as object),
      handlingSessionId: sessionId,
    } as never);
    reply.status(result.status === "accepted" ? 201 : 202);
    return result;
  });

  app.post("/api/v1/handling-sessions/:sessionId/close", async (request: FastifyRequest) => {
    const { sessionId } = request.params as { sessionId: string };
    return service.closeSession(ctx(request), sessionId);
  });

  app.get("/api/v1/handling-sessions/:sessionId/exceptions", async (request: FastifyRequest) => {
    const { sessionId } = request.params as { sessionId: string };
    const items = await service.listExceptions(ctx(request), sessionId);
    return { items };
  });

  // Idempotent edge ingestion (Appendix C: 207 per-observation partial success).
  app.post("/api/v1/device-observations:batch", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { observations?: unknown[] };
    const observations = Array.isArray(body.observations) ? body.observations : [];
    const results = await service.ingestBatch(ctx(request), observations as never);
    reply.status(207);
    return { results };
  });

  app.get("/api/v1/animals/:animalId/weights", async (request: FastifyRequest) => {
    const { animalId } = request.params as { animalId: string };
    const items = await service.getWeightSeries(ctx(request), animalId);
    return { items };
  });

  app.get("/api/v1/animals/:animalId/adg", async (request: FastifyRequest) => {
    const { animalId } = request.params as { animalId: string };
    const adg = await service.computeAdg(ctx(request), animalId);
    return adg ?? { animalId, adgKgPerDay: null, reason: "insufficient eligible readings" };
  });
}
