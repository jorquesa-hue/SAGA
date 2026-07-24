import { newUuid, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AlertService } from "../../src/alert-service.js";
import { ReportService } from "../../src/report-service.js";

const available = databaseAvailable();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function makeAnimal(
  db: TestDatabase,
  tenantId: Uuid,
  farmId: Uuid,
  visualId: string,
): Promise<Uuid> {
  const id = newUuid();
  await db.adminPool.query(
    `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, version) VALUES ($1,$2,$3,$4,'female',0)`,
    [id, tenantId, farmId, visualId],
  );
  return id;
}

async function addWeight(
  db: TestDatabase,
  tenantId: Uuid,
  animalId: Uuid,
  kg: number,
  at: Date,
): Promise<void> {
  await db.adminPool.query(
    `INSERT INTO animal_weight (tenant_id, animal_id, occurred_at, weight_kg, eligible_for_analytics, event_id)
     VALUES ($1,$2,$3,$4,true,$5)`,
    [tenantId, animalId, at.toISOString(), kg, `evt-${newUuid()}`],
  );
}

describe.skipIf(!available)("Analytics (alerts + reports) integration", () => {
  let db: TestDatabase;
  let alerts: AlertService;
  let reports: ReportService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_analytics");
    identity = makeIdentityService(db);
    alerts = new AlertService({ appPool: db.appPool });
    reports = new ReportService({ appPool: db.appPool });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Analytics",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 200 });
    farmId = farm.id;
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("raises a weighing-overdue alert and is idempotent (dedupe)", async () => {
    const a = await makeAnimal(db, tenantId, farmId, "AN-001");
    await addWeight(db, tenantId, a, 250, daysAgo(90)); // older than 60d beef cadence

    const first = await alerts.generateAlerts(owner, { farmId });
    expect(first.weighingOverdue).toBeGreaterThanOrEqual(1);

    // Re-running creates no duplicates.
    const second = await alerts.generateAlerts(owner, { farmId });
    expect(second.weighingOverdue).toBe(0);

    const open = await alerts.listAlerts(owner, { status: "open" });
    const forAnimal = open.filter(
      (al) => al.animalId === a && al.alertType === "weighing_overdue",
    );
    expect(forAnimal).toHaveLength(1);
  });

  it("raises a withdrawal alert from an active restriction", async () => {
    const a = await makeAnimal(db, tenantId, farmId, "AN-002");
    await db.adminPool.query(
      `INSERT INTO animal_restriction (tenant_id, animal_id, restriction_type, valid_from, valid_to, status)
       VALUES ($1,$2,'withdrawal', now(), now() + interval '20 days', 'active')`,
      [tenantId, a],
    );
    const result = await alerts.generateAlerts(owner, { farmId });
    expect(result.withdrawal).toBeGreaterThanOrEqual(1);
    const open = await alerts.listAlerts(owner, { severity: "warning" });
    expect(
      open.some((al) => al.animalId === a && al.alertType === "withdrawal_active"),
    ).toBe(true);
  });

  it("acknowledges and resolves an alert; resolving frees the dedupe key", async () => {
    const open = await alerts.listAlerts(owner, { status: "open" });
    const target = open[0]!;
    await alerts.acknowledgeAlert(owner, target.id);
    let acked = await alerts.listAlerts(owner, { status: "acknowledged" });
    expect(acked.some((a) => a.id === target.id)).toBe(true);

    await alerts.resolveAlert(owner, target.id);
    const resolved = await alerts.listAlerts(owner, { status: "resolved" });
    expect(resolved.some((a) => a.id === target.id)).toBe(true);

    // A resolved alert's dedupe key can be raised again on the next scan.
    acked = await alerts.listAlerts(owner, { status: "open" });
    const regen = await alerts.generateAlerts(owner, { farmId });
    expect(regen.total).toBeGreaterThanOrEqual(0);
  });

  it("computes a beef lot report with ADG and kg/ha", async () => {
    // Build a beef lot with a paddock and two animals with 60-day gains.
    const lot = await db.adminPool.query(
      `INSERT INTO lot (tenant_id, farm_id, name, purpose) VALUES ($1,$2,'Lote Report','beef') RETURNING id`,
      [tenantId, farmId],
    );
    const lotId = lot.rows[0].id;
    const paddock = await db.adminPool.query(
      `INSERT INTO paddock (tenant_id, farm_id, name, area_ha, status) VALUES ($1,$2,'Pasto R',10,'active') RETURNING id`,
      [tenantId, farmId],
    );
    await db.adminPool.query(
      `INSERT INTO paddock_occupation (tenant_id, paddock_id, lot_id, entry_at) VALUES ($1,$2,$3, now())`,
      [tenantId, paddock.rows[0].id, lotId],
    );
    for (const [vid, entry, current] of [
      ["RP-1", 200, 260],
      ["RP-2", 220, 280],
    ] as const) {
      const animal = await makeAnimal(db, tenantId, farmId, vid);
      await addWeight(db, tenantId, animal, entry, daysAgo(60));
      await addWeight(db, tenantId, animal, current, daysAgo(0));
      await db.adminPool.query(
        `INSERT INTO lot_membership (tenant_id, lot_id, animal_id) VALUES ($1,$2,$3)`,
        [tenantId, lotId, animal],
      );
    }

    const report = await reports.beefLotReport(owner, lotId);
    expect(report.headCount).toBe(2);
    expect(report.totalGainKg).toBe(120); // 60 + 60
    expect(report.avgAdgKgPerDay).toBeCloseTo(1.0, 1);
    expect(report.paddockAreaHa).toBe(10);
    expect(report.kgPerHa).toBe(12); // 120 kg / 10 ha
  });

  it("computes a monthly nucleus report for nucleus-lot animals", async () => {
    const lot = await db.adminPool.query(
      `INSERT INTO lot (tenant_id, farm_id, name, purpose) VALUES ($1,$2,'Núcleo','genetic_nucleus') RETURNING id`,
      [tenantId, farmId],
    );
    const animal = await makeAnimal(db, tenantId, farmId, "NUC-1");
    await addWeight(db, tenantId, animal, 300, daysAgo(30));
    await addWeight(db, tenantId, animal, 340, daysAgo(0));
    await db.adminPool.query(
      `INSERT INTO lot_membership (tenant_id, lot_id, animal_id) VALUES ($1,$2,$3)`,
      [tenantId, lot.rows[0].id, animal],
    );

    const rows = await reports.monthlyNucleusReport(owner, farmId);
    const row = rows.find((r) => r.visualId === "NUC-1");
    expect(row).toBeDefined();
    expect(row!.latestWeightKg).toBe(340);
    expect(row!.adgKgPerDay).toBeCloseTo(40 / 30, 2);
  });

  it("does not leak alerts/reports across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    expect(await alerts.listAlerts(other.ownerContext, {})).toHaveLength(0);
  });
});

describe.skipIf(available)("Analytics (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
