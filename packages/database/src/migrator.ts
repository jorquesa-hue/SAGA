import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

/**
 * Checksum-enforced SQL migration runner (Appendix B "Migration Rules"):
 *  - migrations are ordered by numeric prefix and immutable after release;
 *  - each applied migration records a sha256 checksum;
 *  - drift (edited applied migration) fails loudly;
 *  - out-of-order additions fail loudly;
 *  - each migration runs inside one transaction.
 */

export interface MigrationFile {
  name: string;
  ordinal: number;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
  applied_at: Date;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

const MIGRATION_FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

export async function loadMigrations(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory);
  const files = entries.filter((f) => MIGRATION_FILE_RE.test(f)).sort();
  const invalid = entries.filter((f) => f.endsWith(".sql") && !MIGRATION_FILE_RE.test(f));
  if (invalid.length > 0) {
    throw new Error(
      `Migration file names must match NNNN_snake_case.sql; invalid: ${invalid.join(", ")}`,
    );
  }
  const migrations: MigrationFile[] = [];
  const seenOrdinals = new Set<number>();
  for (const name of files) {
    const ordinal = Number(MIGRATION_FILE_RE.exec(name)![1]);
    if (seenOrdinals.has(ordinal)) {
      throw new Error(`Duplicate migration ordinal ${ordinal} (${name})`);
    }
    seenOrdinals.add(ordinal);
    const sql = await readFile(join(directory, name), "utf8");
    migrations.push({
      name,
      ordinal,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  return migrations;
}

async function ensureMigrationTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function migrate(
  pool: pg.Pool,
  directory: string,
  options: { logger?: (message: string) => void } = {},
): Promise<MigrateResult> {
  const log = options.logger ?? (() => {});
  const migrations = await loadMigrations(directory);
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    // Serialize concurrent migration runs (advisory lock, arbitrary stable key).
    await client.query("SELECT pg_advisory_lock(727274)");
    await ensureMigrationTable(client);
    const { rows: appliedRows } = await client.query<AppliedMigration>(
      "SELECT name, checksum, applied_at FROM schema_migration ORDER BY name",
    );
    const appliedByName = new Map(appliedRows.map((r) => [r.name, r]));

    // Verify checksums of everything already applied, and ordering: no new
    // migration may sort before an applied one.
    let lastAppliedName = "";
    for (const row of appliedRows) {
      const file = migrations.find((m) => m.name === row.name);
      if (!file) {
        throw new Error(
          `Applied migration '${row.name}' is missing from ${directory} — migrations are immutable after release`,
        );
      }
      if (file.checksum !== row.checksum) {
        throw new Error(
          `Checksum drift on applied migration '${row.name}' — migrations are immutable after release`,
        );
      }
      if (row.name > lastAppliedName) lastAppliedName = row.name;
    }
    for (const migration of migrations) {
      if (!appliedByName.has(migration.name) && migration.name < lastAppliedName) {
        throw new Error(
          `Migration '${migration.name}' sorts before already-applied '${lastAppliedName}' — out-of-order migrations are forbidden`,
        );
      }
    }

    for (const migration of migrations) {
      if (appliedByName.has(migration.name)) {
        skipped.push(migration.name);
        continue;
      }
      log(`applying ${migration.name}`);
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migration (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration '${migration.name}' failed: ${(error as Error).message}`,
          { cause: error },
        );
      }
      applied.push(migration.name);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
  return { applied, skipped };
}

/** Verify that every migration on disk is applied with a matching checksum. */
export async function verifyMigrations(
  pool: pg.Pool,
  directory: string,
): Promise<{ ok: boolean; problems: string[] }> {
  const migrations = await loadMigrations(directory);
  const problems: string[] = [];
  const { rows } = await pool.query<AppliedMigration>(
    "SELECT name, checksum, applied_at FROM schema_migration",
  );
  const appliedByName = new Map(rows.map((r) => [r.name, r]));
  for (const migration of migrations) {
    const row = appliedByName.get(migration.name);
    if (!row) {
      problems.push(`not applied: ${migration.name}`);
    } else if (row.checksum !== migration.checksum) {
      problems.push(`checksum drift: ${migration.name}`);
    }
  }
  for (const row of rows) {
    if (!migrations.some((m) => m.name === row.name)) {
      problems.push(`applied but missing on disk: ${row.name}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
