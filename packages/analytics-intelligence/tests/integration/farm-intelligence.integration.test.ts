import { newUuid, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FarmIntelligenceService } from "../../src/farm-intelligence.js";

const available = databaseAvailable();

async function makeAnimal(
  db: TestDatabase,
  tenantId: Uuid,
  farmId: Uuid,
  visualId: string,
  rfid?: string,
): Promise<Uuid> {
  const id = newUuid();
  await db.adminPool.query(
    `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, version) VALUES ($1,$2,$3,$4,'female',0)`,
    [id, tenantId, farmId, visualId],
  );
  if (rfid) {
    await db.adminPool.query(
      `INSERT INTO animal_identifier (id, tenant_id, animal_id, identifier_type, identifier_value, valid_from)
       VALUES ($1,$2,$3,'rfid',$4, now())`,
      [newUuid(), tenantId, id, rfid],
    );
    await db.adminPool.query(
      `INSERT INTO animal_weight (tenant_id, animal_id, occurred_at, weight_kg, eligible_for_analytics, event_id)
       VALUES ($1,$2, now(), 300, true, $3)`,
      [tenantId, id, `e-${newUuid()}`],
    );
  }
  return id;
}

describe.skipIf(!available)("FarmIntelligenceService (integration)", () => {
  let db: TestDatabase;
  let fii: FarmIntelligenceService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_fii");
    identity = makeIdentityService(db);
    fii = new FarmIntelligenceService({ appPool: db.appPool });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda FII",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    farmId = farm.id;
    // 4 animals; 3 fully tracked (rfid + recent weight), 1 untracked.
    await makeAnimal(db, tenantId, farmId, "F-1", "982000000010001");
    await makeAnimal(db, tenantId, farmId, "F-2", "982000000010002");
    await makeAnimal(db, tenantId, farmId, "F-3", "982000000010003");
    await makeAnimal(db, tenantId, farmId, "F-4");
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("computes a versioned, transparent Farm Intelligence Index (§60)", async () => {
    const index = await fii.computeIndex(owner, farmId);
    expect(index.formulaVersion).toBe("fii-v1");
    expect(index.score).toBeGreaterThan(0);
    expect(index.score).toBeLessThanOrEqual(100);

    // Every component exposes score, weight, and weighted contribution.
    expect(index.components.length).toBeGreaterThanOrEqual(6);
    const trace = index.components.find((c) => c.domain === "identity_traceability")!;
    expect(trace.score).toBeCloseTo(0.75, 2); // 3 of 4 have RFID
    expect(trace.detail.withRfid).toBe(3);

    // The composite equals the weighted sum / total weight * 100.
    const totalWeight = index.components.reduce((s, c) => s + c.weight, 0);
    const expected =
      (100 * index.components.reduce((s, c) => s + c.weightedContribution, 0)) /
      totalWeight;
    expect(index.score).toBeCloseTo(Math.round(expected * 10) / 10, 1);
  });

  it("produces an executive dashboard including herd counts and FII (§26)", async () => {
    const dash = await fii.executiveDashboard(owner, farmId);
    expect(dash.herd.active).toBe(4);
    expect(dash.herd.byStatus.active).toBe(4);
    expect(dash.farmIntelligenceIndex).toBeGreaterThan(0);
    expect(dash.alerts).toBeDefined();
  });

  it("does not leak across tenants (other tenant sees an empty-herd index)", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    const index = await fii.computeIndex(other.ownerContext);
    // No animals → traceability/timely default handling keeps score bounded.
    expect(index.score).toBeGreaterThanOrEqual(0);
    expect(index.score).toBeLessThanOrEqual(100);
    const trace = index.components.find((c) => c.domain === "identity_traceability")!;
    expect(trace.detail.activeAnimals).toBe(0);
  });
});

describe.skipIf(available)("FarmIntelligenceService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
