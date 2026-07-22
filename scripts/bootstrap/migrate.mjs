#!/usr/bin/env node
/**
 * Apply database/policies (local roles) and database/migrations to
 * DATABASE_URL (or TEST_DATABASE_URL with --verify, which additionally
 * verifies checksums after applying).
 *
 * Requires `pnpm --filter @jk/database build` first (done by `pnpm build`).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import "dotenv/config";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = join(root, "database/migrations");
const policiesFile = join(root, "database/policies/application_roles.sql");
const migratorPath = join(root, "packages/database/dist/migrator.js");

if (!existsSync(migratorPath)) {
  console.error("Build @jk/database first: pnpm --filter @jk/database build");
  process.exit(1);
}
const { migrate, verifyMigrations } = await import(pathToFileURL(migratorPath).href);

const verifyMode = process.argv.includes("--verify");
const url = verifyMode
  ? (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)
  : process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL (or TEST_DATABASE_URL with --verify) is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 2 });

try {
  // Local/CI role provisioning is idempotent; production roles are
  // infrastructure-provisioned, in which case this warns and continues.
  try {
    await pool.query(await readFile(policiesFile, "utf8"));
  } catch (error) {
    console.warn(`role provisioning skipped: ${error.message}`);
  }

  const result = await migrate(pool, migrationsDir, { logger: console.log });
  console.log(
    `migrations: ${result.applied.length} applied, ${result.skipped.length} already applied`,
  );

  if (verifyMode) {
    const verification = await verifyMigrations(pool, migrationsDir);
    if (!verification.ok) {
      console.error("verification problems:", verification.problems);
      process.exit(1);
    }
    console.log("verification: all migrations applied with matching checksums");
  }
} finally {
  await pool.end();
}
