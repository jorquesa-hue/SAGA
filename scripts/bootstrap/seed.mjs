#!/usr/bin/env node
/**
 * Apply database/seeds/*.sql (synthetic reference farm) to DATABASE_URL.
 *
 * Runs on the owner/system connection. Requires migrations to have been
 * applied first. Idempotent: seeds use ON CONFLICT DO NOTHING, so re-running
 * yields identical counts. NEVER loads production data (§27, §87).
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const seedsDir = join(root, "database/seeds");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 2 });

try {
  // Fail clearly if the schema is not migrated yet.
  const migrated = await pool.query(
    "SELECT to_regclass('public.schema_migration') IS NOT NULL AS ok",
  );
  if (!migrated.rows[0].ok) {
    console.error("Database is not migrated. Run: pnpm db:migrate");
    process.exit(1);
  }

  const files = (await readdir(seedsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    console.log(`seeding ${file}`);
    await pool.query(await readFile(join(seedsDir, file), "utf8"));
  }

  const summary = await pool.query(`
    SELECT 'tenant' AS entity, count(*)::int AS n FROM tenant
    UNION ALL SELECT 'farm', count(*)::int FROM farm
    UNION ALL SELECT 'paddock', count(*)::int FROM paddock
    UNION ALL SELECT 'user_account', count(*)::int FROM user_account
    UNION ALL SELECT 'tenant_membership', count(*)::int FROM tenant_membership
    UNION ALL SELECT 'farm_membership', count(*)::int FROM farm_membership
    UNION ALL SELECT 'animal', count(*)::int FROM animal
    UNION ALL SELECT 'animal_identifier', count(*)::int FROM animal_identifier
    UNION ALL SELECT 'domain_event', count(*)::int FROM domain_event
    UNION ALL SELECT 'outbox_message', count(*)::int FROM outbox_message
    ORDER BY entity
  `);
  console.log("\nseed summary:");
  for (const row of summary.rows) {
    console.log(`  ${row.entity.padEnd(20)} ${row.n}`);
  }
} finally {
  await pool.end();
}
