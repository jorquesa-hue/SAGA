import type { FastifyInstance } from "fastify";
import type pg from "pg";

/**
 * Kubernetes health probes (§76). Liveness/startup are process checks;
 * readiness verifies both database pools answer a trivial query. These are
 * NOT under /api/v1 and require no authentication.
 */
export function registerHealthRoutes(
  app: FastifyInstance,
  pools: { systemPool: pg.Pool; appPool: pg.Pool },
): void {
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/startup", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await Promise.all([
        pools.systemPool.query("SELECT 1"),
        pools.appPool.query("SELECT 1"),
      ]);
      return { status: "ok", checks: { systemDb: "ok", appDb: "ok" } };
    } catch {
      reply.status(503).type("application/problem+json");
      return {
        type: "https://jk.example/problems/not-ready",
        title: "NotReady",
        status: 503,
        detail: "One or more dependencies are unavailable",
        code: "JK-NOT-READY",
      };
    }
  });
}
