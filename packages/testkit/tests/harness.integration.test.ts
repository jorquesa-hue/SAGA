import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, databaseAvailable, type TestDatabase } from "../src/pg-harness.js";
import { makeIdentityService, seedTenantWithOwner } from "../src/fixtures.js";

const available = databaseAvailable();

describe.skipIf(!available)("pg-harness self-test", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase("jk_tk_self");
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("applies the baseline and exposes the three role pools", async () => {
    const tables = await db.adminPool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = tables.rows.map((r) => r.tablename);
    expect(names).toContain("tenant");
    expect(names).toContain("domain_event");
    expect(names).toContain("schema_migration");
  });

  it("seeds a tenant with a bootstrapped owner", async () => {
    const service = makeIdentityService(db);
    const seeded = await seedTenantWithOwner(service, "Fazenda Harness", "owner@example.com");
    expect(seeded.tenantId).toBeTruthy();
    expect(seeded.ownerUserId).toBeTruthy();
    const farms = await service.listFarms(seeded.ownerContext);
    expect(Array.isArray(farms)).toBe(true);
  });
});

describe.skipIf(available)("pg-harness self-test (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
