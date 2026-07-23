import { newUuid, NotFoundError, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  makeTenantContext,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LandForbiddenError, LandGrazingService } from "../../src/index.js";

const available = databaseAvailable();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe.skipIf(!available)("LandGrazingService (integration)", () => {
  let db: TestDatabase;
  let land: LandGrazingService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;
  let paddockId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_land");
    identity = makeIdentityService(db);
    land = new LandGrazingService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(identity, "Fazenda Pasto", "owner@example.com");
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 200 });
    farmId = farm.id;
    const p = await db.adminPool.query(
      `INSERT INTO paddock (tenant_id, farm_id, name, area_ha, status) VALUES ($1,$2,'Pasto 1',10,'active') RETURNING id`,
      [tenantId, farmId],
    );
    paddockId = p.rows[0].id;
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("records a pasture assessment with an event", async () => {
    const a = await land.recordAssessment(owner, {
      paddockId,
      method: "visual",
      condition: "good",
      availabilityKgDmHa: 2500,
    });
    expect(a.condition).toBe("good");
    const events = await db.adminPool.query(
      `SELECT event_type FROM domain_event WHERE aggregate_id = $1 AND event_type = 'land.pasture_assessed.v1'`,
      [paddockId],
    );
    expect(events.rows.length).toBe(1);
    const list = await land.listAssessments(owner, paddockId);
    expect(list).toHaveLength(1);
  });

  it("computes grazing metrics: stocking rate, grazing days, kg/ha", async () => {
    // A lot occupies the paddock with two weighed animals gaining weight.
    const lot = await db.adminPool.query(
      `INSERT INTO lot (tenant_id, farm_id, name, purpose) VALUES ($1,$2,'Lote G','beef') RETURNING id`,
      [tenantId, farmId],
    );
    const lotId = lot.rows[0].id;
    await db.adminPool.query(
      `INSERT INTO paddock_occupation (tenant_id, paddock_id, lot_id, entry_at) VALUES ($1,$2,$3,$4)`,
      [tenantId, paddockId, lotId, daysAgo(30).toISOString()],
    );
    for (const [vid, entry, current] of [["G-1", 200, 260], ["G-2", 210, 250]] as const) {
      const animal = newUuid();
      await db.adminPool.query(
        `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, version) VALUES ($1,$2,$3,$4,'female',0)`,
        [animal, tenantId, farmId, vid],
      );
      await db.adminPool.query(
        `INSERT INTO animal_weight (tenant_id, animal_id, occurred_at, weight_kg, eligible_for_analytics, event_id)
         VALUES ($1,$2,$3,$4,true,$5),($1,$2,$6,$7,true,$8)`,
        [tenantId, animal, daysAgo(30).toISOString(), entry, `e-${newUuid()}`, daysAgo(0).toISOString(), current, `e-${newUuid()}`],
      );
      await db.adminPool.query(
        `INSERT INTO lot_membership (tenant_id, lot_id, animal_id) VALUES ($1,$2,$3)`,
        [tenantId, lotId, animal],
      );
    }

    const m = await land.getGrazingMetrics(owner, paddockId);
    expect(m.areaHa).toBe(10);
    expect(m.currentHeadCount).toBe(2);
    expect(m.stockingRateHeadPerHa).toBe(0.2); // 2 head / 10 ha
    expect(m.totalGrazingDays).toBeGreaterThanOrEqual(29);
    expect(m.latestCondition).toBe("good");
    expect(m.kgPerHa).toBe(10); // (60 + 40) kg / 10 ha
    expect(m.dataComplete).toBe(true);
  });

  it("denies a finance_user from recording assessments (403)", async () => {
    const invite = await identity.inviteUser(owner, {
      email: "fin@example.com",
      displayName: "Fin",
      role: "finance_user",
    });
    await identity.activateMembership(owner, { userId: invite.userId, role: "finance_user" });
    const finance = makeTenantContext(tenantId, invite.userId);
    await expect(
      land.recordAssessment(finance, { paddockId, condition: "fair" }),
    ).rejects.toBeInstanceOf(LandForbiddenError);
  });

  it("rejects assessing a missing paddock", async () => {
    await expect(
      land.recordAssessment(owner, { paddockId: newUuid(), condition: "good" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not leak assessments across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    await expect(land.listAssessments(other.ownerContext, paddockId)).resolves.toEqual([]);
  });
});

describe.skipIf(available)("LandGrazingService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
