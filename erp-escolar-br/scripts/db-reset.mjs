#!/usr/bin/env node
// Drops and recreates the `public` schema, then applies (in order):
//   1. tests/support/local-auth-shim.sql — only when LOCAL_TEST_SHIM=1
//   2. supabase/migrations/*.sql          — always
//   3. tests/fixtures/seed-two-escolas.sql — only when APPLY_FIXTURES=1
//
// Requires ADMIN_DATABASE_URL: a superuser (or table-owner) connection —
// RLS does not restrict this connection, which is exactly what applying
// migrations/DDL needs.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const databaseUrl = process.env.ADMIN_DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "ADMIN_DATABASE_URL is required (superuser connection to the target database).",
  );
  process.exit(1);
}

const applyLocalShim = process.env.LOCAL_TEST_SHIM === "1";
const applyFixtures = process.env.APPLY_FIXTURES === "1";

async function run() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("drop schema if exists public cascade;");
    await client.query("create schema public;");

    if (applyLocalShim) {
      const shim = readFileSync(
        path.join(root, "tests/support/local-auth-shim.sql"),
        "utf8",
      );
      await client.query(shim);
    }

    const migrationsDir = path.join(root, "supabase/migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      try {
        await client.query(sql);
      } catch (err) {
        console.error(`Migration failed: ${file}`);
        throw err;
      }
    }

    if (applyFixtures) {
      const fixture = readFileSync(
        path.join(root, "tests/fixtures/seed-two-escolas.sql"),
        "utf8",
      );
      await client.query(fixture);
    }

    console.log(`Database reset complete (${files.length} migrations applied).`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
