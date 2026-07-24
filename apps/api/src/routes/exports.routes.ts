import type { ExportService } from "@jk/analytics-intelligence";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/** Secure export REST surface (§27, JK-ANI-006). */
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

export function registerExportRoutes(app: FastifyInstance, exports: ExportService): void {
  const ctx = (r: FastifyRequest) =>
    buildTenantContext(r.principal, tenant(r), r.correlationId);

  app.post("/api/v1/exports", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const job = await exports.requestExport(ctx(r), {
      ...(r.body as object),
      idempotencyKey: `export:${key}`,
    } as never);
    reply.status(202);
    return job;
  });

  app.get("/api/v1/exports", async (r: FastifyRequest) => {
    const q = r.query as { status?: string };
    return { items: await exports.listExportJobs(ctx(r), q.status) };
  });

  app.get("/api/v1/exports/:id", async (r: FastifyRequest) => {
    const { id } = r.params as { id: string };
    return exports.getExportJob(ctx(r), id);
  });

  // Synchronous processing trigger (the async worker path calls the same method).
  app.post("/api/v1/exports/:id/process", async (r: FastifyRequest) => {
    idem(r);
    const { id } = r.params as { id: string };
    return exports.processExport(ctx(r), id);
  });

  app.get(
    "/api/v1/exports/:id/download",
    async (r: FastifyRequest, reply: FastifyReply) => {
      const { id } = r.params as { id: string };
      const file = await exports.downloadExport(ctx(r), id);
      const contentType =
        file.format === "csv"
          ? "text/csv"
          : file.format === "json"
            ? "application/json"
            : "application/octet-stream";
      reply.header("x-content-checksum-sha256", file.checksum);
      reply.type(contentType);
      return file.content;
    },
  );
}
