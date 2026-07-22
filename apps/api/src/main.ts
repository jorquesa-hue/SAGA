import "dotenv/config";
import { createLogger } from "@jk/observability";
import { buildApp } from "./app.js";
import { loadApiConfig } from "./config.js";
import { createPools } from "./pools.js";

/**
 * API entry point. Loads typed config (fails fast on invalid critical config),
 * opens the database pools, builds the app, and listens. Graceful shutdown on
 * SIGTERM/SIGINT drains connections.
 */
async function main(): Promise<void> {
  const config = loadApiConfig();
  const logger = createLogger({
    service: "jk-api",
    environment: config.APP_ENV,
    level: config.LOG_LEVEL,
  });

  const pools = createPools(config);
  const app = await buildApp({ config, pools, logger });

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ port: config.PORT, env: config.APP_ENV }, "jk-api listening");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    await app.close();
    await pools.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
   
  console.error("fatal startup error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
