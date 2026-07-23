import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { JkPlatformClient } from "@jk/contracts-rest";
import { HttpSyncTransport } from "@jk/sync-http";
import { loadEdgeConfig } from "./config.js";
import { FileLocalStore } from "./file-store.js";
import { EdgeGateway, type DeviceReading } from "./gateway.js";

/**
 * Edge gateway entrypoint (§34): a durable local ingest buffer plus a periodic
 * upstream flush. Device readers on the LAN POST to /ingest; readings are
 * persisted to disk and pushed to the platform in idempotent batches. Health
 * endpoints and graceful shutdown match the other services.
 */
function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(JSON.stringify({ level, time: new Date().toISOString(), service: "jk-edge-gateway", msg, ...extra }) + "\n");
}

async function main(): Promise<void> {
  const config = loadEdgeConfig();
  const client = new JkPlatformClient({
    baseUrl: config.API_BASE_URL,
    tenantId: config.EDGE_TENANT_ID,
    auth: config.EDGE_API_TOKEN
      ? { mode: "bearer", getToken: () => config.EDGE_API_TOKEN! }
      : { mode: "dev", devUserId: config.EDGE_DEV_USER_ID! },
  });
  const store = new FileLocalStore(config.EDGE_DATA_FILE);
  const gateway = new EdgeGateway({
    store,
    transport: new HttpSyncTransport(client),
    gatewayId: config.EDGE_GATEWAY_ID,
    batchSize: config.BATCH_SIZE,
  });

  const flushTimer = setInterval(() => {
    void gateway
      .flush()
      .then((r) => {
        if (r.attempted > 0) log("info", "flush", { ...r });
      })
      .catch((e) => log("error", "flush_failed", { error: (e as Error).message }));
  }, config.FLUSH_INTERVAL_MS);

  const server = createServer((req, res) => void handle(req, res));

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url?.split("?")[0] ?? "/";
    if (req.method === "GET" && url === "/health/live") return json(res, 200, { status: "live" });
    if (req.method === "GET" && url === "/health/ready") return json(res, 200, { status: "ready" });
    if (req.method === "GET" && url === "/status") return json(res, 200, await gateway.status(store));
    if (req.method === "POST" && url === "/ingest") {
      const body = await readJson(req);
      const { id } = await gateway.ingest(body as DeviceReading);
      return json(res, 202, { buffered: true, id });
    }
    if (req.method === "POST" && url === "/ingest:batch") {
      const body = (await readJson(req)) as { readings?: DeviceReading[] };
      const { ids } = await gateway.ingestBatch(Array.isArray(body.readings) ? body.readings : []);
      return json(res, 202, { buffered: ids.length, ids });
    }
    json(res, 404, { status: "not_found" });
  }

  server.listen(config.PORT, () => log("info", "edge_gateway_started", { port: config.PORT, gatewayId: config.EDGE_GATEWAY_ID }));

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(flushTimer);
    await gateway.flush().catch(() => undefined); // best-effort drain
    await new Promise<void>((resolve) => server.close(() => resolve()));
    log("info", "edge_gateway_stopped", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

main().catch((error) => {
  log("error", "edge_gateway_startup_failed", { error: (error as Error).message });
  process.exit(1);
});
