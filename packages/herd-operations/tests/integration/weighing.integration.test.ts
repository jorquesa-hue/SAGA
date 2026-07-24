import {
  createTenantContext,
  newUuid,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  makeTenantContext,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WeighingService } from "../../src/weighing-service.js";
import { HerdForbiddenError } from "../../src/errors.js";

const available = databaseAvailable();

/** Insert an animal + active RFID directly (owner pool) to arrange test state. */
async function makeAnimal(
  db: TestDatabase,
  tenantId: Uuid,
  farmId: Uuid,
  visualId: string,
  rfid: string,
): Promise<Uuid> {
  const animalId = newUuid();
  await db.adminPool.query(
    `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, version)
     VALUES ($1,$2,$3,$4,'female',0)`,
    [animalId, tenantId, farmId, visualId],
  );
  await db.adminPool.query(
    `INSERT INTO animal_identifier (id, tenant_id, animal_id, identifier_type, identifier_value, valid_from)
     VALUES ($1,$2,$3,'rfid',$4, now())`,
    [newUuid(), tenantId, animalId, rfid],
  );
  return animalId;
}

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe.skipIf(!available)("WeighingService (integration)", () => {
  let db: TestDatabase;
  let weighing: WeighingService;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;
  let animalA: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_weigh");
    const identity = makeIdentityService(db);
    weighing = new WeighingService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Peso",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    farmId = farm.id;
    animalA = await makeAnimal(db, tenantId, farmId, "BR-W001", "982000000000101");
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("starts a session and accepts a resolved weight (event + read model)", async () => {
    const session = await weighing.startSession(owner, {
      farmId,
      purpose: "weighing",
      expectedCount: 1,
    });
    expect(session.status).toBe("open");

    const result = await weighing.recordObservation(owner, {
      observationId: "obs-1",
      capturedAt: iso(daysAgo(30)),
      value: 300,
      unit: "kg",
      rfid: "982000000000101",
      handlingSessionId: session.id,
    });
    expect(result.status).toBe("accepted");
    expect(result.animalId).toBe(animalA);
    expect(result.eventId).toBeTruthy();

    const series = await weighing.getWeightSeries(owner, animalA);
    expect(series).toHaveLength(1);
    expect(series[0]!.weightKg).toBe(300);
  });

  it("is idempotent on replay (same gateway + observationId → duplicate)", async () => {
    const first = await weighing.recordObservation(owner, {
      observationId: "obs-dup",
      capturedAt: iso(daysAgo(20)),
      value: 305,
      unit: "kg",
      rfid: "982000000000101",
    });
    const replay = await weighing.recordObservation(owner, {
      observationId: "obs-dup",
      capturedAt: iso(daysAgo(20)),
      value: 305,
      unit: "kg",
      rfid: "982000000000101",
    });
    expect(first.status).toBe("accepted");
    expect(replay.status).toBe("duplicate");
    expect(replay.serverObservationId).toBe(first.serverObservationId);
  });

  it("routes an unresolved RFID to the exception queue (never discarded)", async () => {
    const result = await weighing.recordObservation(owner, {
      observationId: "obs-unresolved",
      capturedAt: iso(daysAgo(10)),
      value: 280,
      unit: "kg",
      rfid: "982999999999999",
    });
    expect(result.status).toBe("pending_resolution");
    const exceptions = await weighing.listExceptions(owner);
    expect(exceptions.some((e) => e.observationId === "obs-unresolved")).toBe(true);
  });

  it("rejects a non-positive weight as a validation exception", async () => {
    const result = await weighing.recordObservation(owner, {
      observationId: "obs-invalid",
      capturedAt: iso(daysAgo(10)),
      value: 0,
      unit: "kg",
      rfid: "982000000000101",
    });
    expect(result.status).toBe("rejected_validation");
  });

  it("flags an implausible change but does not reject it (§11)", async () => {
    const animalB = await makeAnimal(db, tenantId, farmId, "BR-W002", "982000000000102");
    await weighing.recordObservation(owner, {
      observationId: "b-1",
      capturedAt: iso(daysAgo(5)),
      value: 250,
      unit: "kg",
      rfid: "982000000000102",
    });
    // +200 kg in 1 day → implausible.
    const jump = await weighing.recordObservation(owner, {
      observationId: "b-2",
      capturedAt: iso(daysAgo(4)),
      value: 450,
      unit: "kg",
      rfid: "982000000000102",
    });
    expect(jump.status).toBe("accepted");
    expect(jump.qualityFlags).toContain("implausible_change");

    const series = await weighing.getWeightSeries(owner, animalB);
    const flagged = series.find((s) => s.weightKg === 450);
    expect(flagged?.eligibleForAnalytics).toBe(false);
  });

  it("computes ADG from eligible readings only", async () => {
    const animalC = await makeAnimal(db, tenantId, farmId, "BR-W003", "982000000000103");
    // 200 kg at day-60, 260 kg at day-0 → 60 kg over 60 days = 1.0 kg/day.
    await weighing.recordObservation(owner, {
      observationId: "c-1",
      capturedAt: iso(daysAgo(60)),
      value: 200,
      unit: "kg",
      rfid: "982000000000103",
    });
    await weighing.recordObservation(owner, {
      observationId: "c-2",
      capturedAt: iso(daysAgo(0)),
      value: 260,
      unit: "kg",
      rfid: "982000000000103",
    });
    const adg = await weighing.computeAdg(owner, animalC);
    expect(adg).not.toBeNull();
    expect(adg!.adgKgPerDay).toBeCloseTo(1.0, 1);
    expect(adg!.eligiblePoints).toBe(2);
  });

  it("closes a session with a counts summary", async () => {
    const session = await weighing.startSession(owner, {
      farmId,
      purpose: "weighing",
      expectedCount: 2,
    });
    await weighing.recordObservation(owner, {
      observationId: "close-1",
      capturedAt: iso(daysAgo(1)),
      value: 310,
      unit: "kg",
      rfid: "982000000000101",
      handlingSessionId: session.id,
    });
    await weighing.recordObservation(owner, {
      observationId: "close-2",
      capturedAt: iso(daysAgo(1)),
      value: 290,
      unit: "kg",
      rfid: "982111111111111",
      handlingSessionId: session.id,
    });
    const closed = await weighing.closeSession(owner, session.id);
    expect(closed.status).toBe("closed");
    expect(closed.summary?.processed).toBe(2);
    expect(closed.summary?.accepted).toBe(1);
    expect(closed.summary?.pendingResolution).toBe(1);
  });

  it("ingests a batch with partial success", async () => {
    const results = await weighing.ingestBatch(owner, [
      {
        observationId: "batch-1",
        capturedAt: iso(daysAgo(2)),
        value: 315,
        unit: "kg",
        rfid: "982000000000101",
      },
      {
        observationId: "batch-2",
        capturedAt: iso(daysAgo(2)),
        value: 0,
        unit: "kg",
        rfid: "982000000000101",
      },
      {
        observationId: "batch-3",
        capturedAt: iso(daysAgo(2)),
        value: 288,
        unit: "kg",
        rfid: "982000000000999",
      },
    ]);
    expect(results).toHaveLength(3);
    expect(results.find((r) => r.observationId === "batch-1")?.status).toBe("accepted");
    expect(results.find((r) => r.observationId === "batch-2")?.status).toBe(
      "rejected_validation",
    );
    expect(results.find((r) => r.observationId === "batch-3")?.status).toBe(
      "pending_resolution",
    );
  });

  it("allows a device actor to record weights", async () => {
    const deviceContext = createTenantContext({
      tenantId,
      actor: { type: "device", id: newUuid() },
      correlationId: newUuid(),
    });
    const result = await weighing.recordObservation(deviceContext, {
      observationId: "device-1",
      gatewayId: "gw-1",
      capturedAt: iso(daysAgo(1)),
      value: 320,
      unit: "kg",
      rfid: "982000000000101",
    });
    expect(result.status).toBe("accepted");
  });

  it("denies a finance_user from recording weights (403)", async () => {
    const identity = makeIdentityService(db);
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
      weighing.recordObservation(finance, {
        observationId: "fin-1",
        capturedAt: iso(daysAgo(1)),
        value: 300,
        unit: "kg",
        rfid: "982000000000101",
      }),
    ).rejects.toBeInstanceOf(HerdForbiddenError);
  });

  it("does not leak weights across tenants", async () => {
    const other = await seedTenantWithOwner(
      makeIdentityService(db),
      "Outra",
      "o@example.com",
    );
    const series = await weighing.getWeightSeries(other.ownerContext, animalA);
    expect(series).toHaveLength(0);
  });
});

describe.skipIf(available)("WeighingService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
