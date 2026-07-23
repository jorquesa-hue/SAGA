import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { RecommendationService } from "@jk/analytics-intelligence";
import { createPool } from "@jk/database";
import { createTenantContext, type TenantContext, type Uuid } from "@jk/domain-kernel";
import { loadOrchestratorConfig } from "./config.js";
import { Orchestrator } from "./orchestrator.js";

/**
 * AI orchestrator entrypoint (§62): a per-tenant analysis loop plus health and
 * a manual /analyze trigger. It enumerates active tenants (owner pool) and runs
 * the Orchestrator under an agent-actor context for each; all writes go through
 * the governed recommendation service (evidence, kill switch, prohibited block).
 */
function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(JSON.stringify({ level, time: new Date().toISOString(), service: "jk-ai-orchestrator", msg, ...extra }) + "\n");
}

function agentContext(tenantId: Uuid): TenantContext {
  return createTenantContext({
    tenantId,
    actor: { type: "agent", id: randomUUID(), display: "ai-orchestrator" },
    correlationId: randomUUID(),
  });
}

async function main(): Promise<void> {
  const config = loadOrchestratorConfig();
  const systemPool = createPool({ connectionString: config.DATABASE_URL, applicationName: "jk-ai-orchestrator-sys" });
  const appPool = createPool({ connectionString: config.APP_DATABASE_URL, applicationName: "jk-ai-orchestrator" });
  const recommendations = new RecommendationService({ appPool, environment: config.APP_ENV, aiEnabled: config.AI_ENABLED });
  const orchestrator = new Orchestrator({ appPool, recommendations, environment: config.APP_ENV });

  async function activeTenants(): Promise<Uuid[]> {
    const r = await systemPool.query<{ id: Uuid }>(`SELECT id FROM tenant WHERE status = 'active'`);
    return r.rows.map((row) => row.id);
  }

  async function analyzeAll(): Promise<void> {
    if (!config.AI_ENABLED) return; // kill switch: do no work at all
    for (const tenantId of await activeTenants()) {
      try {
        const report = await orchestrator.analyzeTenant(agentContext(tenantId));
        if (report.created.length > 0 || report.blockedByPolicy.length > 0) {
          log("info", "tenant_analyzed", { tenantId, ...report });
        }
      } catch (e) {
        log("error", "tenant_analysis_failed", { tenantId, error: (e as Error).message });
      }
    }
  }

  const timer = setInterval(() => void analyzeAll().catch(() => undefined), config.ANALYZE_INTERVAL_MS);

  const server = createServer((req, res) => void handle(req, res));
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url?.split("?")[0] ?? "/";
    if (req.method === "GET" && url === "/health/live") return json(res, 200, { status: "live", aiEnabled: config.AI_ENABLED });
    if (req.method === "GET" && url === "/health/ready") {
      try {
        await appPool.query("SELECT 1");
        return json(res, 200, { status: "ready" });
      } catch {
        return json(res, 503, { status: "unavailable" });
      }
    }
    const analyze = url.match(/^\/analyze\/([0-9a-f-]{36})$/);
    if (req.method === "POST" && analyze) {
      const report = await orchestrator.analyzeTenant(agentContext(analyze[1] as Uuid));
      return json(res, 200, report);
    }
    json(res, 404, { status: "not_found" });
  }

  server.listen(config.PORT, () => log("info", "ai_orchestrator_started", { port: config.PORT, aiEnabled: config.AI_ENABLED }));

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await appPool.end().catch(() => undefined);
    await systemPool.end().catch(() => undefined);
    log("info", "ai_orchestrator_stopped", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

main().catch((error) => {
  log("error", "ai_orchestrator_startup_failed", { error: (error as Error).message });
  process.exit(1);
});
