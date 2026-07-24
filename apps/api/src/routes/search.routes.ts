import type { SearchService } from "@jk/analytics-intelligence";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { buildTenantContext } from "../request-context.js";

/** Global search REST surface (§27). */
function tenant(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-tenant-id"];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function registerSearchRoutes(app: FastifyInstance, search: SearchService): void {
  app.get("/api/v1/search", async (r: FastifyRequest) => {
    const ctx = buildTenantContext(r.principal, tenant(r), r.correlationId);
    const q = r.query as { q?: string; limit?: string };
    return search.search(ctx, q.q ?? "", q.limit ? Number(q.limit) : undefined);
  });
}
