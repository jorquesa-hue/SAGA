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
import { LotsService } from "../../src/lots-service.js";
import { HerdForbiddenError } from "../../src/errors.js";

const available = databaseAvailable();

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

async function makePaddock(
  db: TestDatabase,
  tenantId: Uuid,
  farmId: Uuid,
  name: string,
): Promise<Uuid> {
  const id = newUuid();
  await db.adminPool.query(
    `INSERT INTO paddock (id, tenant_id, farm_id, name, area_ha, status) VALUES ($1,$2,$3,$4,10,'active')`,
    [id, tenantId, farmId, name],
  );
  return id;
}

describe.skipIf(!available)("LotsService (integration)", () => {
  let db: TestDatabase;
  let lots: LotsService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_lots");
    identity = makeIdentityService(db);
    lots = new LotsService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Lotes",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    farmId = farm.id;
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("creates a lot, adds animals, and projects membership (JK-HER-001/002/004)", async () => {
    const lot = await lots.createLot(owner, {
      farmId,
      name: "Lote Recria A",
      purpose: "rearing",
    });
    const a1 = await makeAnimal(db, tenantId, farmId, "BR-L001");
    const a2 = await makeAnimal(db, tenantId, farmId, "BR-L002");

    const results = await lots.addAnimals(owner, { lotId: lot.id, animalIds: [a1, a2] });
    expect(results.every((r) => r.status === "added")).toBe(true);

    const members = await lots.getLotMembers(owner, lot.id);
    expect(members.sort()).toEqual([a1, a2].sort());
    expect(await lots.getAnimalLot(owner, a1)).toBe(lot.id);
  });

  it("moving an animal to another lot closes the prior membership (one active lot)", async () => {
    const lotA = await lots.createLot(owner, { farmId, name: "Lote A", purpose: "beef" });
    const lotB = await lots.createLot(owner, { farmId, name: "Lote B", purpose: "beef" });
    const animal = await makeAnimal(db, tenantId, farmId, "BR-L010");

    await lots.addAnimals(owner, { lotId: lotA.id, animalIds: [animal] });
    await lots.addAnimals(owner, { lotId: lotB.id, animalIds: [animal] });

    expect(await lots.getAnimalLot(owner, animal)).toBe(lotB.id);
    expect(await lots.getLotMembers(owner, lotA.id)).not.toContain(animal);

    // Exactly one active membership row exists for the animal.
    const active = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM lot_membership WHERE animal_id = $1 AND valid_to IS NULL`,
      [animal],
    );
    expect(Number(active.rows[0]!.n)).toBe(1);
  });

  it("moves a lot between paddocks, closing the prior occupation (JK-HER-003)", async () => {
    const lot = await lots.createLot(owner, {
      farmId,
      name: "Lote Pasto",
      purpose: "beef",
    });
    const p1 = await makePaddock(db, tenantId, farmId, "Pasto A");
    const p2 = await makePaddock(db, tenantId, farmId, "Pasto B");

    await lots.moveToPaddock(owner, { lotId: lot.id, paddockId: p1, headCount: 20 });
    expect(await lots.getCurrentPaddock(owner, lot.id)).toBe(p1);

    await lots.moveToPaddock(owner, { lotId: lot.id, paddockId: p2, headCount: 20 });
    expect(await lots.getCurrentPaddock(owner, lot.id)).toBe(p2);

    // Exactly one open occupation; the prior one is closed with an exit time.
    const open = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM paddock_occupation WHERE lot_id = $1 AND exit_at IS NULL`,
      [lot.id],
    );
    expect(Number(open.rows[0]!.n)).toBe(1);
    const closed = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM paddock_occupation WHERE lot_id = $1 AND exit_at IS NOT NULL`,
      [lot.id],
    );
    expect(Number(closed.rows[0]!.n)).toBe(1);
  });

  it("removes an animal from a lot", async () => {
    const lot = await lots.createLot(owner, {
      farmId,
      name: "Lote Remove",
      purpose: "beef",
    });
    const animal = await makeAnimal(db, tenantId, farmId, "BR-L020");
    await lots.addAnimals(owner, { lotId: lot.id, animalIds: [animal] });
    const removed = await lots.removeAnimals(owner, {
      lotId: lot.id,
      animalIds: [animal],
    });
    expect(removed[0]!.status).toBe("removed");
    expect(await lots.getAnimalLot(owner, animal)).toBeNull();
  });

  it("reports errors for missing animals in a batch add (partial success)", async () => {
    const lot = await lots.createLot(owner, {
      farmId,
      name: "Lote Parcial",
      purpose: "beef",
    });
    const good = await makeAnimal(db, tenantId, farmId, "BR-L030");
    const results = await lots.addAnimals(owner, {
      lotId: lot.id,
      animalIds: [good, newUuid()],
    });
    expect(results.filter((r) => r.status === "added")).toHaveLength(1);
    expect(results.filter((r) => r.status === "error")).toHaveLength(1);
  });

  it("denies a finance_user from managing lots (403)", async () => {
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
      lots.createLot(finance, { farmId, name: "Proibido", purpose: "beef" }),
    ).rejects.toBeInstanceOf(HerdForbiddenError);
  });

  it("rejects moving to a missing paddock", async () => {
    const lot = await lots.createLot(owner, { farmId, name: "Lote NF", purpose: "beef" });
    await expect(
      lots.moveToPaddock(owner, { lotId: lot.id, paddockId: newUuid() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not leak lots across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    const lot = await lots.createLot(owner, {
      farmId,
      name: "Lote Secreto",
      purpose: "beef",
    });
    await expect(lots.getLotMembers(other.ownerContext, lot.id)).resolves.toEqual([]);
  });
});

describe.skipIf(available)("LotsService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
