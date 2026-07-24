import { createPool } from "@jk/database";
import type pg from "pg";
import type { ApiConfig } from "./config.js";

export interface DatabasePools {
  systemPool: pg.Pool;
  appPool: pg.Pool;
  close(): Promise<void>;
}

/**
 * The system pool (owner) is used only for tenant onboarding; the app pool
 * (jk_app) carries RLS-enforced tenant-scoped traffic (§67).
 */
export function createPools(config: ApiConfig): DatabasePools {
  const systemPool = createPool({
    connectionString: config.DATABASE_URL,
    applicationName: "jk-api-system",
  });
  const appPool = createPool({
    connectionString: config.APP_DATABASE_URL,
    applicationName: "jk-api-app",
  });
  return {
    systemPool,
    appPool,
    async close() {
      await Promise.allSettled([systemPool.end(), appPool.end()]);
    },
  };
}
