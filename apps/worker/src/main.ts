import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createPool } from "@jk/database";
import { loadWorkerConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { OutboxRelay } from "./outbox-relay.js";
import { EventStatsProjector } from "./projector.js";
import { LogPublisher, NatsJetStreamPublisher, type EventPublisher } from "./publisher.js";

/**
 * Worker entrypoint (§31.1 steps 4-5, §77): outbox relay + in-process
 * projection consumer, health endpoints, graceful shutdown.
 */

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = createLogger(
    { service: "jk-worker", env: config.APP_ENV },
    { level: config.LOG_LEVEL },
  );

  const pool = createPool({
    connectionString: config.WORKER_DATABASE_URL,
    applicationName: "jk-worker",
  });

  const publisher: EventPublisher = config.NATS_URL
    ? new NatsJetStreamPublisher(config.NATS_URL)
    : new LogPublisher(logger);
  logger.info("publisher_selected", {
    transport: config.NATS_URL ? "nats-jetstream" : "log",
  });

  const relay = new OutboxRelay({
    pool,
    publisher,
    projector: new EventStatsProjector(),
    batchSize: config.OUTBOX_BATCH_SIZE,
    logger,
  });
  relay.start(config.POLL_INTERVAL_MS);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url?.split("?")[0] ?? "/";
    if (req.method === "GET" && url === "/health/live") {
      respondJson(res, 200, { status: "live", service: "jk-worker" });
      return;
    }
    if (req.method === "GET" && url === "/health/ready") {
      try {
        await pool.query("SELECT 1");
        respondJson(res, 200, { status: "ready", service: "jk-worker" });
      } catch {
        respondJson(res, 503, { status: "unavailable", service: "jk-worker" });
      }
      return;
    }
    respondJson(res, 404, { status: "not_found" });
  }

  server.listen(config.PORT, () => {
    logger.info("worker_started", {
      port: config.PORT,
      pollIntervalMs: config.POLL_INTERVAL_MS,
      batchSize: config.OUTBOX_BATCH_SIZE,
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("worker_stopping", { signal });
    await relay.stop();
    await publisher.close?.().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    logger.info("worker_stopped", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

main().catch((error) => {
  // Configuration or bootstrap failure: fail startup loudly (Appendix G).
   
  console.error(
    JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      service: "jk-worker",
      msg: "worker_startup_failed",
      error: (error as Error).message,
    }),
  );
  process.exit(1);
});
