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
import { HealthService } from "../../src/health-service.js";
import { HealthForbiddenError } from "../../src/errors.js";

const available = databaseAvailable();

async function makeAnimal(db: TestDatabase, tenantId: Uuid, farmId: Uuid, visualId: string): Promise<Uuid> {
  const animalId = newUuid();
  await db.adminPool.query(
    `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, version) VALUES ($1,$2,$3,$4,'female',0)`,
    [animalId, tenantId, farmId, visualId],
  );
  return animalId;
}

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe.skipIf(!available)("HealthService (integration)", () => {
  let db: TestDatabase;
  let health: HealthService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;
  let animalId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_health");
    identity = makeIdentityService(db);
    health = new HealthService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(identity, "Fazenda Saúde", "owner@example.com");
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    farmId = farm.id;
    animalId = await makeAnimal(db, tenantId, farmId, "BR-H001");
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("records a treatment with a withdrawal period and blocks sale-clear (JK-HLT-005, JK-DOM-011)", async () => {
    const treatment = await health.recordTreatment(owner, {
      animalId,
      kind: "treatment",
      productName: "Oxitetraciclina LA",
      medicineBatch: "LOTE-2026-07",
      dose: 20,
      doseUnit: "mL",
      route: "IM",
      administeredAt: iso(daysAgo(2)),
      withdrawalDays: 28,
    });
    expect(treatment.withdrawalUntil).not.toBeNull();

    const restrictions = await health.listActiveRestrictions(owner, animalId);
    expect(restrictions).toHaveLength(1);
    expect(restrictions[0]!.restrictionType).toBe("withdrawal");

    const saleClear = await health.checkSaleClear(owner, animalId);
    expect(saleClear.clear).toBe(false);
    expect(saleClear.activeRestrictions).toHaveLength(1);

    // The treatment_administered + restriction_started events are on the timeline.
    const events = await db.adminPool.query(
      `SELECT event_type FROM domain_event WHERE aggregate_id = $1 AND aggregate_type = 'animal'`,
      [animalId],
    );
    const types = events.rows.map((r) => r.event_type);
    expect(types).toContain("animal.treatment_administered.v1");
    expect(types).toContain("animal.restriction_started.v1");
  });

  it("clears sale status via an authorized, documented override (vet), and records it", async () => {
    // Invite + activate a veterinarian.
    const invite = await identity.inviteUser(owner, {
      email: "vet@example.com",
      displayName: "Vet",
      role: "veterinarian",
    });
    await identity.activateMembership(owner, { userId: invite.userId, role: "veterinarian" });
    const vet = makeTenantContext(tenantId, invite.userId);

    const active = await health.listActiveRestrictions(owner, animalId);
    const restrictionId = active[0]!.id;

    const overridden = await health.overrideRestriction(vet, {
      restrictionId,
      reason: "Emergency slaughter authorized by attending veterinarian",
    });
    expect(overridden.status).toBe("overridden");

    const saleClear = await health.checkSaleClear(owner, animalId);
    expect(saleClear.clear).toBe(true);

    const audits = await db.adminPool.query(
      `SELECT count(*)::int AS n FROM audit_record
       WHERE tenant_id = $1 AND action = 'health.restriction_overridden'`,
      [tenantId],
    );
    expect(audits.rows[0].n).toBeGreaterThan(0);
  });

  it("denies a technician from overriding a withdrawal restriction (403)", async () => {
    const animal2 = await makeAnimal(db, tenantId, farmId, "BR-H002");
    await health.recordTreatment(owner, {
      animalId: animal2,
      productName: "Antibiótico",
      administeredAt: iso(daysAgo(1)),
      withdrawalDays: 14,
    });
    const active = await health.listActiveRestrictions(owner, animal2);

    const invite = await identity.inviteUser(owner, {
      email: "tec@example.com",
      displayName: "Tec",
      role: "technician",
    });
    await identity.activateMembership(owner, { userId: invite.userId, role: "technician" });
    const tech = makeTenantContext(tenantId, invite.userId);

    await expect(
      health.overrideRestriction(tech, { restrictionId: active[0]!.id, reason: "quero liberar" }),
    ).rejects.toBeInstanceOf(HealthForbiddenError);

    // Still blocked.
    expect((await health.checkSaleClear(owner, animal2)).clear).toBe(false);
  });

  it("treats a zero/short withdrawal as no restriction (sale-clear stays clear)", async () => {
    const animal3 = await makeAnimal(db, tenantId, farmId, "BR-H003");
    await health.recordTreatment(owner, {
      animalId: animal3,
      kind: "vaccination",
      productName: "Vacina Clostridiose",
      administeredAt: iso(daysAgo(1)),
      // no withdrawalDays
    });
    expect((await health.checkSaleClear(owner, animal3)).clear).toBe(true);
  });

  it("runs a batch treatment with per-animal results and exceptions (JK-HLT-003)", async () => {
    const a1 = await makeAnimal(db, tenantId, farmId, "BR-H010");
    const a2 = await makeAnimal(db, tenantId, farmId, "BR-H011");
    const missing = newUuid();
    const results = await health.batchTreatment(owner, {
      animalIds: [a1, a2, missing],
      kind: "vaccination",
      productName: "Vacina Aftosa",
      administeredAt: iso(daysAgo(0)),
    });
    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.status === "administered")).toHaveLength(2);
    expect(results.find((r) => r.animalId === missing)?.status).toBe("error");
  });

  it("opens and resolves a clinical case (JK-HLT-006)", async () => {
    const opened = await health.openCase(owner, {
      animalId,
      symptom: "claudicação membro posterior direito",
      diagnosis: "suspeita de podridão de casco",
    });
    expect(opened.status).toBe("open");
    const resolved = await health.resolveCase(owner, opened.id, "tratado, recuperação completa");
    expect(resolved.status).toBe("resolved");
    expect(resolved.outcome).toContain("recuperação");
  });

  it("rejects treating a missing animal", async () => {
    await expect(
      health.recordTreatment(owner, {
        animalId: newUuid(),
        productName: "X",
        administeredAt: iso(daysAgo(0)),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not leak health data across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    const treatments = await health.getAnimalTreatments(other.ownerContext, animalId);
    expect(treatments).toHaveLength(0);
    // And another tenant sees no active restriction on our animal.
    expect((await health.listActiveRestrictions(other.ownerContext, animalId))).toHaveLength(0);
  });
});

describe.skipIf(available)("HealthService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
