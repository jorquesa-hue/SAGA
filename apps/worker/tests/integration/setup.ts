import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "@jk/database";
import pg from "pg";

/**
 * Integration test harness (same pattern as packages/database): creates a
 * disposable database, provisions the local application roles, applies ALL
 * migrations (0001..0004 — the worker projection tables ride the baseline),
 * and exposes pools for admin (owner), app (RLS-enforced), and worker roles.
 */

const __dir = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(__dir, "../../../../database/migrations");
export const POLICIES_FILE = join(
  __dir,
  "../../../../database/policies/application_roles.sql",
);

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://jk:jk@localhost:5432/postgres";

export interface TestDatabase {
  name: string;
  adminPool: pg.Pool;
  appPool: pg.Pool;
  workerPool: pg.Pool;
  /** Additional worker-role pool (concurrent relay tests). */
  createWorkerPool(): pg.Pool;
  destroy(): Promise<void>;
}

export async function createTestDatabase(prefix = "jk_worker_it"): Promise<TestDatabase> {
  const name = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const bootstrap = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`CREATE DATABASE ${name}`);
  await bootstrap.end();

  const base = new URL(ADMIN_URL);
  base.pathname = `/${name}`;
  const adminPool = new pg.Pool({ connectionString: base.toString(), max: 4 });

  // Provision local application roles (idempotent, cluster-wide), then apply
  // every migration so guarded grants/policies bind to those roles.
  await adminPool.query(await readFile(POLICIES_FILE, "utf8"));
  await migrate(adminPool, MIGRATIONS_DIR);

  const appUrl = new URL(base.toString());
  appUrl.username = "jk_app";
  appUrl.password = "jk_app_local";
  const appPool = new pg.Pool({ connectionString: appUrl.toString(), max: 4 });

  const workerUrl = new URL(base.toString());
  workerUrl.username = "jk_worker";
  workerUrl.password = "jk_worker_local";
  const workerPool = new pg.Pool({ connectionString: workerUrl.toString(), max: 4 });
  const extraPools: pg.Pool[] = [];

  return {
    name,
    adminPool,
    appPool,
    workerPool,
    createWorkerPool() {
      const pool = new pg.Pool({ connectionString: workerUrl.toString(), max: 2 });
      extraPools.push(pool);
      return pool;
    },
    async destroy() {
      await Promise.all(extraPools.map((pool) => pool.end().catch(() => {})));
      await appPool.end();
      await workerPool.end();
      await adminPool.end();
      const cleanup = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

/** True when a local PostgreSQL is reachable; used to skip when unavailable. */
export function databaseAvailable(): boolean {
  try {
    execSync(`psql "${ADMIN_URL}" -c "SELECT 1" -q -o /dev/null`, {
      stdio: "ignore",
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}
