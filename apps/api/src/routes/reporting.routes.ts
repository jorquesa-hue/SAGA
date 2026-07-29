import type { ReportingService } from "@jk/reporting";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildTenantContext } from "../request-context.js";

/** Reporting REST surface (§26 mandatory reports, §47 tenant-scoped reads). */
function tenant(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-tenant-id"];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function registerReportingRoutes(
  app: FastifyInstance,
  reporting: ReportingService,
): void {
  const ctx = (r: FastifyRequest) =>
    buildTenantContext(r.principal, tenant(r), r.correlationId);

  app.get("/api/v1/reporting/reports", async (r: FastifyRequest) => {
    return { items: await reporting.listReports(ctx(r)) };
  });

  // Read-only preview: run a report and return the result WITHOUT recording it.
  app.get("/api/v1/reporting/reports/:reportKey/preview", async (r: FastifyRequest) => {
    const { reportKey } = r.params as { reportKey: string };
    const q = r.query as Record<string, string | undefined>;
    const params: Record<string, unknown> = {};
    for (const key of ["farmId", "lotId", "dateFrom", "dateTo"]) {
      if (q[key]) params[key] = q[key];
    }
    return reporting.previewReport(ctx(r), { reportKey, params });
  });

  app.post(
    "/api/v1/reporting/reports/:reportKey/run",
    async (r: FastifyRequest, reply: FastifyReply) => {
      const { reportKey } = r.params as { reportKey: string };
      const body = (r.body ?? {}) as { params?: Record<string, unknown> };
      const result = await reporting.runReport(ctx(r), {
        reportKey,
        params: body.params,
      });
      reply.status(201);
      return result;
    },
  );

  app.get("/api/v1/reporting/runs", async (r: FastifyRequest) => {
    const q = r.query as { reportKey?: string; limit?: string };
    return {
      items: await reporting.listRuns(ctx(r), {
        reportKey: q.reportKey,
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    };
  });

  // The CSV download is matched before the plain :id route so ".csv" is not
  // swallowed as part of the id.
  app.get(
    "/api/v1/reporting/runs/:id.csv",
    async (r: FastifyRequest, reply: FastifyReply) => {
      const { id } = r.params as { id: string };
      const file = await reporting.downloadRunCsv(ctx(r), id);
      reply.header("x-content-checksum-sha256", file.checksum);
      reply.header("content-disposition", `attachment; filename="${file.filename}"`);
      reply.type("text/csv");
      return file.content;
    },
  );

  app.get("/api/v1/reporting/runs/:id", async (r: FastifyRequest) => {
    const { id } = r.params as { id: string };
    return reporting.getRun(ctx(r), id);
  });
}
