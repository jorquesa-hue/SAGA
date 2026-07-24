import {
  newUuid,
  ValidationError,
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
import { ReproductionGeneticsService } from "../../src/reproduction-service.js";
import { ReproForbiddenError } from "../../src/errors.js";

const available = databaseAvailable();

async function makeAnimal(
  db: TestDatabase,
  tenantId: Uuid,
  farmId: Uuid,
  visualId: string,
  sex: "female" | "male",
): Promise<Uuid> {
  const id = newUuid();
  await db.adminPool.query(
    `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, version) VALUES ($1,$2,$3,$4,$5,0)`,
    [id, tenantId, farmId, visualId, sex],
  );
  return id;
}

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe.skipIf(!available)("ReproductionGeneticsService (integration)", () => {
  let db: TestDatabase;
  let repro: ReproductionGeneticsService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;
  let dam: Uuid;
  let bull: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_repro");
    identity = makeIdentityService(db);
    repro = new ReproductionGeneticsService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Repro",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    farmId = farm.id;
    dam = await makeAnimal(db, tenantId, farmId, "BR-DAM-1", "female");
    bull = await makeAnimal(db, tenantId, farmId, "BR-BULL-1", "male");
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("runs service → positive check → calving with linked calf and pedigree (JK-REP-006)", async () => {
    const service = await repro.recordService(owner, {
      damId: dam,
      method: "tai",
      serviceDate: iso(daysAgo(283)),
      bullId: bull,
      semenBatch: "SB-2025-01",
    });
    expect(service.method).toBe("tai");

    let status = await repro.getReproductionStatus(owner, dam);
    expect(status.state).toBe("served");

    const check = await repro.recordPregnancyCheck(owner, {
      damId: dam,
      serviceId: service.id,
      checkDate: iso(daysAgo(250)),
      method: "ultrasound",
      result: "positive",
    });
    expect(check.result).toBe("positive");
    expect(check.expectedCalvingDate).not.toBeNull();

    status = await repro.getReproductionStatus(owner, dam);
    expect(status.state).toBe("pregnant");
    expect(status.expectedCalvingDate).toBe(check.expectedCalvingDate);

    const calving = await repro.recordCalving(owner, {
      damId: dam,
      serviceId: service.id,
      calvingDate: iso(daysAgo(0)),
      ease: "unassisted",
      outcome: "live",
      birthWeightKg: 34,
      sireConfidence: "known",
      calf: { farmId, visualId: "BR-CALF-1", sex: "female", rfid: "982000000007001" },
    });
    expect(calving.outcome).toBe("live");
    expect(calving.calfId).toBeTruthy();

    // The calf exists as an animal with a registered event and parentage edges.
    const calf = await db.adminPool.query(
      `SELECT sex, birth_date FROM animal WHERE id = $1`,
      [calving.calfId],
    );
    expect(calf.rows[0].sex).toBe("female");

    const parentage = await db.adminPool.query<{
      relation: string;
      parent_id: string | null;
      confidence: string;
    }>(
      `SELECT relation, parent_id, confidence FROM animal_parentage WHERE child_id = $1 ORDER BY relation`,
      [calving.calfId],
    );
    const damEdge = parentage.rows.find((p) => p.relation === "dam");
    const sireEdge = parentage.rows.find((p) => p.relation === "sire");
    expect(damEdge?.parent_id).toBe(dam);
    expect(sireEdge?.parent_id).toBe(bull);

    status = await repro.getReproductionStatus(owner, dam);
    expect(status.state).toBe("calved");

    // The dam's timeline carries all three reproduction events.
    const events = await db.adminPool.query(
      `SELECT event_type FROM domain_event WHERE aggregate_id = $1`,
      [dam],
    );
    const types = events.rows.map((r) => r.event_type);
    expect(types).toContain("reproduction.service_recorded.v1");
    expect(types).toContain("reproduction.pregnancy_checked.v1");
    expect(types).toContain("reproduction.calving_recorded.v1");
  });

  it("records a negative check leaving the dam open", async () => {
    const dam2 = await makeAnimal(db, tenantId, farmId, "BR-DAM-2", "female");
    await repro.recordService(owner, {
      damId: dam2,
      method: "ai",
      serviceDate: iso(daysAgo(40)),
    });
    await repro.recordPregnancyCheck(owner, {
      damId: dam2,
      checkDate: iso(daysAgo(1)),
      result: "negative",
    });
    const status = await repro.getReproductionStatus(owner, dam2);
    expect(status.state).toBe("open");
  });

  it("rejects reproduction events on a male animal", async () => {
    await expect(
      repro.recordService(owner, {
        damId: bull,
        method: "natural",
        serviceDate: iso(daysAgo(1)),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects registering a calf when outcome is not live", async () => {
    const dam3 = await makeAnimal(db, tenantId, farmId, "BR-DAM-3", "female");
    await expect(
      repro.recordCalving(owner, {
        damId: dam3,
        calvingDate: iso(daysAgo(0)),
        outcome: "stillborn",
        calf: { farmId, visualId: "BR-CALF-X", sex: "male" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("denies a finance_user from recording reproduction (403)", async () => {
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
      repro.recordService(finance, {
        damId: dam,
        method: "ai",
        serviceDate: iso(daysAgo(1)),
      }),
    ).rejects.toBeInstanceOf(ReproForbiddenError);
  });

  it("does not leak reproduction data across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    const status = await repro.getReproductionStatus(other.ownerContext, dam);
    // Another tenant cannot see our dam's services/checks → projects as 'open'.
    expect(status.state).toBe("open");
    expect(status.lastServiceDate).toBeNull();
  });
});

describe.skipIf(available)("ReproductionGeneticsService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
