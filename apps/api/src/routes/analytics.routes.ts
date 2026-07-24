import type { AlertService, ReportService } from "@jk/analytics-intelligence";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildTenantContext } from "../request-context.js";

/** Analytics and Intelligence REST surface (§26). */
function tenant(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-tenant-id"];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function registerAnalyticsRoutes(
  app: FastifyInstance,
  alerts: AlertService,
  reports: ReportService,
): void {
  const ctx = (r: FastifyRequest) =>
    buildTenantContext(r.principal, tenant(r), r.correlationId);

  app.post("/api/v1/alerts:generate", async (r: FastifyRequest) => {
    const body = (r.body ?? {}) as { farmId?: string };
    return alerts.generateAlerts(ctx(r), { farmId: body.farmId });
  });

  app.get("/api/v1/alerts", async (r: FastifyRequest) => {
    const q = r.query as { status?: string; severity?: string };
    return {
      items: await alerts.listAlerts(ctx(r), { status: q.status, severity: q.severity }),
    };
  });

  app.post(
    "/api/v1/alerts/:alertId/acknowledge",
    async (r: FastifyRequest, reply: FastifyReply) => {
      const { alertId } = r.params as { alertId: string };
      await alerts.acknowledgeAlert(ctx(r), alertId);
      reply.status(204);
    },
  );

  app.post(
    "/api/v1/alerts/:alertId/resolve",
    async (r: FastifyRequest, reply: FastifyReply) => {
      const { alertId } = r.params as { alertId: string };
      await alerts.resolveAlert(ctx(r), alertId);
      reply.status(204);
    },
  );

  app.get("/api/v1/reports/beef-lot/:lotId", async (r: FastifyRequest) => {
    const { lotId } = r.params as { lotId: string };
    return reports.beefLotReport(ctx(r), lotId);
  });

  app.get("/api/v1/reports/monthly-nucleus", async (r: FastifyRequest) => {
    const { farmId } = r.query as { farmId: string };
    return { items: await reports.monthlyNucleusReport(ctx(r), farmId) };
  });
}
