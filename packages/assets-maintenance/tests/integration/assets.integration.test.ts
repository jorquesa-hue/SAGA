import { NotFoundError, newUuid, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  makeTenantContext,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssetForbiddenError, AssetsMaintenanceService } from "../../src/index.js";

const available = databaseAvailable();

describe.skipIf(!available)("AssetsMaintenanceService (integration)", () => {
  let db: TestDatabase;
  let assets: AssetsMaintenanceService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_assets");
    identity = makeIdentityService(db);
    assets = new AssetsMaintenanceService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Ativos",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("registers an asset and schedules calibration", async () => {
    const scale = await assets.registerAsset(owner, {
      name: "Balança Curral 1",
      assetType: "scale",
      model: "TruTest XR5000",
      serial: "SN-001",
    });
    expect(scale.assetType).toBe("scale");
    const sched = await assets.defineSchedule(owner, {
      assetId: scale.id,
      kind: "calibration",
      intervalDays: 180,
    });
    expect(sched.nextDueAt).toBeTruthy();
  });

  it("tracks calibration status (valid vs expired) (JK-AST-004, JK-WGT-007)", async () => {
    const scale = await assets.registerAsset(owner, {
      name: "Balança 2",
      assetType: "scale",
    });
    let status = await assets.getCalibrationStatus(owner, scale.id);
    expect(status.valid).toBe(false); // never calibrated

    await assets.recordCalibration(
      owner,
      scale.id,
      new Date(Date.now() + 90 * 86400000).toISOString(),
    );
    status = await assets.getCalibrationStatus(owner, scale.id);
    expect(status.valid).toBe(true);

    await assets.recordCalibration(
      owner,
      scale.id,
      new Date(Date.now() - 86400000).toISOString(),
    );
    status = await assets.getCalibrationStatus(owner, scale.id);
    expect(status.valid).toBe(false); // expired
  });

  it("opens and completes a work order, toggling asset status", async () => {
    const pump = await assets.registerAsset(owner, {
      name: "Bomba 1",
      assetType: "pump",
    });
    const wo = await assets.createWorkOrder(owner, {
      assetId: pump.id,
      description: "Troca de rolamento",
      priority: "high",
    });

    let a = await db.adminPool.query(`SELECT status FROM asset WHERE id = $1`, [pump.id]);
    expect(a.rows[0].status).toBe("maintenance");

    await assets.completeWorkOrder(owner, wo.workOrderId, {
      laborCost: 150,
      partsCost: 300,
      downtimeHours: 4,
    });
    a = await db.adminPool.query(`SELECT status FROM asset WHERE id = $1`, [pump.id]);
    expect(a.rows[0].status).toBe("active");

    const closed = await db.adminPool.query(
      `SELECT status, parts_cost FROM work_order WHERE id = $1`,
      [wo.workOrderId],
    );
    expect(closed.rows[0].status).toBe("done");
    expect(Number(closed.rows[0].parts_cost)).toBe(300);
  });

  it("lists due maintenance", async () => {
    const asset = await assets.registerAsset(owner, {
      name: "Trator",
      assetType: "machinery",
    });
    await assets.defineSchedule(owner, {
      assetId: asset.id,
      kind: "preventive",
      intervalDays: 30,
      firstDueAt: new Date(Date.now() - 86400000).toISOString(), // already due
    });
    const due = await assets.listDueMaintenance(owner, 0);
    expect(due.some((d) => d.assetId === asset.id)).toBe(true);
  });

  it("denies a finance_user from registering assets (403)", async () => {
    const invite = await identity.inviteUser(owner, {
      email: "fin@example.com",
      displayName: "Fin",
      role: "finance_user",
    });
    await identity.activateMembership(owner, {
      userId: invite.userId,
      role: "finance_user",
    });
    const finance = makeTenantContext(tenantId, invite.userId);
    await expect(
      assets.registerAsset(finance, { name: "X", assetType: "vehicle" }),
    ).rejects.toBeInstanceOf(AssetForbiddenError);
  });

  it("rejects scheduling on a missing asset", async () => {
    await expect(
      assets.defineSchedule(owner, {
        assetId: newUuid(),
        kind: "preventive",
        intervalDays: 30,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not leak assets across tenants", async () => {
    const asset = await assets.registerAsset(owner, {
      name: "Secreto",
      assetType: "gateway",
    });
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    await expect(
      assets.getCalibrationStatus(other.ownerContext, asset.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe.skipIf(available)("AssetsMaintenanceService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
