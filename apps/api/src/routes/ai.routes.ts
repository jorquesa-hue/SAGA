import type { RecommendationService } from "@jk/analytics-intelligence";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/** Governed AI REST surface (§61-§64). */
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

export function registerAiRoutes(app: FastifyInstance, ai: RecommendationService): void {
  const ctx = (r: FastifyRequest) =>
    buildTenantContext(r.principal, tenant(r), r.correlationId);

  app.post("/api/v1/recommendations", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const rec = await ai.createRecommendation(ctx(r), {
      ...(r.body as object),
      idempotencyKey: `rec:${key}`,
    } as never);
    reply.status(201);
    return rec;
  });

  app.get("/api/v1/recommendations", async (r: FastifyRequest) => {
    const q = r.query as { status?: string };
    return { items: await ai.listRecommendations(ctx(r), q.status) };
  });

  app.get("/api/v1/recommendations/:id", async (r: FastifyRequest) => {
    const { id } = r.params as { id: string };
    return ai.getRecommendation(ctx(r), id);
  });

  app.post(
    "/api/v1/recommendations/:id/approve",
    async (r: FastifyRequest, reply: FastifyReply) => {
      idem(r);
      const { id } = r.params as { id: string };
      await ai.approveRecommendation(ctx(r), id);
      reply.status(204);
    },
  );

  app.post(
    "/api/v1/recommendations/:id/reject",
    async (r: FastifyRequest, reply: FastifyReply) => {
      idem(r);
      const { id } = r.params as { id: string };
      const body = (r.body ?? {}) as { reason?: string };
      await ai.rejectRecommendation(ctx(r), id, body.reason ?? "rejected");
      reply.status(204);
    },
  );

  app.post("/api/v1/recommendations/:id/execute", async (r: FastifyRequest) => {
    const { id } = r.params as { id: string };
    return ai.attemptAutonomousExecution(ctx(r), id);
  });
}
