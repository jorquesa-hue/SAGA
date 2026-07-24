import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "@jk/database";
import pg from "pg";

/**
 * Reusable disposable-PostgreSQL harness (§80, §83). Creates a throwaway
 * database, provisions the local application roles, applies all migrations,
 * and exposes pools for the three roles used by the platform:
 *   - admin  (owner): onboarding, migrations, cross-tenant assertions in tests
 *   - app    (jk_app): RLS-enforced tenant-scoped access, as the API uses
 *   - worker (jk_worker): outbox/projection access, as the worker uses
 *
 * A private copy lives in packages/database for its own tests; this is the
 * shared version other packages consume. (Consolidation tracked in docs.)
 */

const __dir = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(__dir, "../../../database/migrations");
export const POLICIES_FILE = join(
  __dir,
  "../../../database/policies/application_roles.sql",
);

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://jk:jk@localhost:5432/postgres";

export interface TestDatabase {
  name: string;
  adminPool: pg.Pool;
  appPool: pg.Pool;
  workerPool: pg.Pool;
  destroy(): Promise<void>;
}

export async function createTestDatabase(
  prefix = "jk_tk",
  options: { applyBaseline?: boolean } = {},
): Promise<TestDatabase> {
  const applyBaseline = options.applyBaseline ?? true;
  const name = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const bootstrap = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`CREATE DATABASE ${name}`);
  await bootstrap.end();

  const base = new URL(ADMIN_URL);
  base.pathname = `/${name}`;
  const adminPool = new pg.Pool({ connectionString: base.toString(), max: 4 });

  await adminPool.query(await readFile(POLICIES_FILE, "utf8"));
  if (applyBaseline) {
    await migrate(adminPool, MIGRATIONS_DIR);
  }

  const appUrl = new URL(base.toString());
  appUrl.username = "jk_app";
  appUrl.password = "jk_app_local";
  const appPool = new pg.Pool({ connectionString: appUrl.toString(), max: 4 });

  const workerUrl = new URL(base.toString());
  workerUrl.username = "jk_worker";
  workerUrl.password = "jk_worker_local";
  const workerPool = new pg.Pool({ connectionString: workerUrl.toString(), max: 2 });

  return {
    name,
    adminPool,
    appPool,
    workerPool,
    async destroy() {
      await appPool.end().catch(() => {});
      await workerPool.end().catch(() => {});
      await adminPool.end().catch(() => {});
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
