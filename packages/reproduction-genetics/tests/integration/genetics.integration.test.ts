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
import { GeneticsService } from "../../src/genetics-service.js";
import { ReproForbiddenError } from "../../src/errors.js";

const available = databaseAvailable();

async function makeAnimal(
  db: TestDatabase,
  tenantId: Uuid,
  farmId: Uuid,
  visualId: string,
  birthDate: string,
): Promise<Uuid> {
  const id = newUuid();
  await db.adminPool.query(
    `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, birth_date, version) VALUES ($1,$2,$3,$4,'female',$5,0)`,
    [id, tenantId, farmId, visualId, birthDate],
  );
  return id;
}

describe.skipIf(!available)("GeneticsService (integration)", () => {
  let db: TestDatabase;
  let genetics: GeneticsService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;
  let a1: Uuid;
  let a2: Uuid;
  let a3: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_genetics");
    identity = makeIdentityService(db);
    genetics = new GeneticsService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Genética",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    farmId = farm.id;
    a1 = await makeAnimal(db, tenantId, farmId, "G-1", "2024-01-01");
    a2 = await makeAnimal(db, tenantId, farmId, "G-2", "2024-06-01");
    a3 = await makeAnimal(db, tenantId, farmId, "G-3", "2025-01-01");
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("imports DEP/EBV evaluations with provenance (JK-GEN-002)", async () => {
    await genetics.importEvaluation(owner, {
      animalId: a1,
      provider: "ANCP",
      evaluationDate: "2026-01-15",
      trait: "weaning_weight",
      value: 12.5,
      percentile: 90,
      reliability: 0.75,
      sourceFile: "ancp_2026.csv",
    });
    const row = await db.adminPool.query(
      `SELECT provider, percentile, reliability, source_file FROM genetic_evaluation WHERE animal_id = $1`,
      [a1],
    );
    expect(row.rows[0].provider).toBe("ANCP");
    expect(Number(row.rows[0].percentile)).toBe(90);
    expect(row.rows[0].source_file).toBe("ancp_2026.csv");
  });

  it("rejects a duplicate evaluation import", async () => {
    await expect(
      genetics.importEvaluation(owner, {
        animalId: a1,
        provider: "ANCP",
        evaluationDate: "2026-01-15",
        trait: "weaning_weight",
        value: 12.5,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("ranks animals by a versioned index, exposing inputs/normalization/exclusions (JK-GEN-004/005)", async () => {
    // a2 and a3 get evaluations; a1 already has weaning_weight only.
    await genetics.importEvaluation(owner, {
      animalId: a2,
      provider: "ANCP",
      evaluationDate: "2026-01-15",
      trait: "weaning_weight",
      value: 8.0,
    });
    await genetics.importEvaluation(owner, {
      animalId: a3,
      provider: "ANCP",
      evaluationDate: "2026-01-15",
      trait: "weaning_weight",
      value: 15.0,
    });
    await genetics.importEvaluation(owner, {
      animalId: a1,
      provider: "ANCP",
      evaluationDate: "2026-01-15",
      trait: "milk",
      value: 5.0,
    });
    await genetics.importEvaluation(owner, {
      animalId: a2,
      provider: "ANCP",
      evaluationDate: "2026-01-15",
      trait: "milk",
      value: 7.0,
    });
    // a3 has NO milk → excluded under default 'exclude' behavior.

    const idx = await genetics.defineSelectionIndex(owner, {
      name: "Índice Materno",
      weights: { weaning_weight: 0.6, milk: 0.4 },
      missingDataBehavior: "exclude",
    });
    const ranked = await genetics.rankAnimals(owner, idx.indexId, [a1, a2, a3]);
    expect(ranked).toHaveLength(3);

    const a3row = ranked.find((r) => r.animalId === a3)!;
    expect(a3row.excluded).toBe(true);
    expect(a3row.exclusionReason).toMatch(/missing/);

    const included = ranked.filter((r) => !r.excluded);
    // Every included animal has a transparent breakdown with normalization.
    expect(included[0]!.breakdown.every((b) => b.weight > 0)).toBe(true);
    expect(included[0]!.score).not.toBeNull();
    // Ranking is score-descending, excluded last.
    expect(ranked[ranked.length - 1]!.excluded).toBe(true);
  });

  it("treat_as_zero index includes animals with missing traits", async () => {
    const idx = await genetics.defineSelectionIndex(owner, {
      name: "Índice Zero",
      weights: { weaning_weight: 1.0, milk: 0.5 },
      missingDataBehavior: "treat_as_zero",
    });
    const ranked = await genetics.rankAnimals(owner, idx.indexId, [a1, a2, a3]);
    expect(ranked.every((r) => !r.excluded)).toBe(true);
  });

  it("reports genetic progress by birth cohort (JK-GEN-006)", async () => {
    const progress = await genetics.geneticProgress(owner, "weaning_weight");
    const y2024 = progress.find((p) => p.birthYear === 2024);
    const y2025 = progress.find((p) => p.birthYear === 2025);
    expect(y2024?.count).toBe(2); // a1 + a2
    expect(y2025?.count).toBe(1); // a3
    expect(y2024?.avgValue).toBeCloseTo((12.5 + 8.0) / 2, 2);
  });

  it("denies a technician from importing evaluations (403)", async () => {
    const invite = await identity.inviteUser(owner, {
      email: "tec@example.com",
      displayName: "Tec",
      role: "technician",
    });
    await identity.activateMembership(owner, {
      userId: invite.userId,
      role: "technician",
    });
    const tech = makeTenantContext(tenantId, invite.userId);
    await expect(
      genetics.importEvaluation(tech, {
        animalId: a1,
        provider: "X",
        evaluationDate: "2026-02-01",
        trait: "t",
        value: 1,
      }),
    ).rejects.toBeInstanceOf(ReproForbiddenError);
  });

  it("does not leak evaluations across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    const progress = await genetics.geneticProgress(other.ownerContext, "weaning_weight");
    expect(progress).toEqual([]);
  });
});

describe.skipIf(available)("GeneticsService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
