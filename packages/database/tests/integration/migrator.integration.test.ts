import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, verifyMigrations } from "../../src/migrator.js";
import { createTestDatabase, databaseAvailable, type TestDatabase } from "./setup.js";

const available = databaseAvailable();

describe.skipIf(!available)("migrator (real PostgreSQL)", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase("jk_migr");
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("applied the full baseline from zero (clean-build gate)", async () => {
    const verification = await verifyMigrations(
      db.adminPool,
      new URL("../../../../database/migrations", import.meta.url).pathname,
    );
    expect(verification.problems).toEqual([]);
    // Core tables exist.
    const { rows } = await db.adminPool.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    const tables = rows.map((r) => r.tablename);
    for (const required of [
      "tenant",
      "farm",
      "animal",
      "animal_identifier",
      "domain_event",
      "outbox_message",
      "user_account",
      "tenant_membership",
      "farm_membership",
      "audit_record",
      "paddock",
      "schema_migration",
    ]) {
      expect(tables).toContain(required);
    }
  });

  it("is idempotent: re-running applies nothing", async () => {
    const dir = new URL("../../../../database/migrations", import.meta.url).pathname;
    const rerun = await migrate(db.adminPool, dir);
    expect(rerun.applied).toEqual([]);
    expect(rerun.skipped.length).toBeGreaterThanOrEqual(3);
  });

  it("detects checksum drift on applied migrations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jk-drift-"));
    await writeFile(join(dir, "0001_first.sql"), "CREATE TABLE drift_a(id int);");
    const scratch = await createTestDatabase("jk_drift", { applyBaseline: false });
    try {
      await migrate(scratch.adminPool, dir);
      // Tamper with the applied migration.
      await writeFile(join(dir, "0001_first.sql"), "CREATE TABLE drift_a(id bigint);");
      await expect(migrate(scratch.adminPool, dir)).rejects.toThrow(/checksum drift/i);
      const verification = await verifyMigrations(scratch.adminPool, dir);
      expect(verification.ok).toBe(false);
    } finally {
      await scratch.destroy();
    }
  });

  it("rejects out-of-order additions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jk-order-"));
    await writeFile(join(dir, "0002_second.sql"), "CREATE TABLE order_b(id int);");
    const scratch = await createTestDatabase("jk_order", { applyBaseline: false });
    try {
      await migrate(scratch.adminPool, dir);
      await writeFile(join(dir, "0001_late.sql"), "CREATE TABLE order_a(id int);");
      await expect(migrate(scratch.adminPool, dir)).rejects.toThrow(/out-of-order/i);
    } finally {
      await scratch.destroy();
    }
  });

  it("enforces append-only domain history at the SQL level (JK-DOM-006)", async () => {
    const { rows } = await db.adminPool.query(
      `INSERT INTO tenant (name, status) VALUES ('Imutável Ltda', 'active') RETURNING id`,
    );
    const tenantId = rows[0].id;
    await db.adminPool.query(
      `INSERT INTO domain_event (
         event_id, tenant_id, event_type, schema_version, aggregate_type,
         aggregate_id, aggregate_version, occurred_at, actor_type, actor_id,
         source_channel, correlation_id, idempotency_key, payload
       ) VALUES ('01TESTEVENT00000000000000A', $1, 'identity.tenant_created.v1', 1,
         'tenant', $1, 1, now(), 'service', 'test', 'system', gen_random_uuid(),
         'append-only-test-1', '{}')`,
      [tenantId],
    );
    await expect(
      db.adminPool.query(
        `UPDATE domain_event SET payload = '{"tampered":true}' WHERE event_id = '01TESTEVENT00000000000000A'`,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.adminPool.query(
        `DELETE FROM domain_event WHERE event_id = '01TESTEVENT00000000000000A'`,
      ),
    ).rejects.toThrow(/append-only/);
  });
});

describe.skipIf(available)("migrator (PostgreSQL unavailable)", () => {
  it("skips integration tests when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
