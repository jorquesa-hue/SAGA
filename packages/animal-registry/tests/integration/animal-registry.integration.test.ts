import {
  ConflictError,
  NotFoundError,
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
import { AnimalRegistryService } from "../../src/animal-registry-service.js";
import { AnimalForbiddenError } from "../../src/errors.js";

const available = databaseAvailable();

describe.skipIf(!available)("AnimalRegistryService (integration)", () => {
  let db: TestDatabase;
  let identity: ReturnType<typeof makeIdentityService>;
  let registry: AnimalRegistryService;
  let ownerContext: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_registry");
    identity = makeIdentityService(db);
    registry = new AnimalRegistryService({ appPool: db.appPool, environment: "test" });

    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Registro",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    ownerContext = seeded.ownerContext;
    const farm = await identity.createFarm(ownerContext, { name: "Sede", areaHa: 100 });
    farmId = farm.id;
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("registers an animal with a stable UUID and a registered event", async () => {
    const animal = await registry.registerAnimal(ownerContext, {
      farmId,
      visualId: "BR-1001",
      sex: "female",
      breedCode: "BRANGUS",
      speciesCode: "BOVINE",
      birthDatePrecision: "exact",
      rfid: "982000000001001",
    });
    expect(animal.id).toMatch(/[0-9a-f-]{36}/);
    expect(animal.lifecycleStatus).toBe("active");
    expect(animal.version).toBe(1);

    const timeline = await registry.getTimeline(ownerContext, animal.id);
    expect(timeline.some((e) => e.eventType === "animal.animal_registered.v1")).toBe(
      true,
    );

    const resolved = await registry.resolveRfid(ownerContext, "982000000001001");
    expect(resolved?.id).toBe(animal.id);
  });

  it("enforces RFID uniqueness among active assignments (JK-DOM-003)", async () => {
    const a = await registry.registerAnimal(ownerContext, {
      farmId,
      visualId: "BR-1002",
      sex: "male",
      rfid: "982000000001002",
    });
    expect(a.id).toBeTruthy();
    // Assigning the same active RFID to another animal is rejected.
    const b = await registry.registerAnimal(ownerContext, {
      farmId,
      visualId: "BR-1003",
      sex: "male",
    });
    await expect(
      registry.assignIdentifier(ownerContext, {
        animalId: b.id,
        identifierType: "rfid",
        identifierValue: "982000000001002",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a duplicate visual id in the same tenant", async () => {
    await registry.registerAnimal(ownerContext, {
      farmId,
      visualId: "BR-DUP",
      sex: "female",
    });
    await expect(
      registry.registerAnimal(ownerContext, {
        farmId,
        visualId: "BR-DUP",
        sex: "female",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("replaces an RFID without losing history, keeping identity (JK-ANI-008)", async () => {
    const animal = await registry.registerAnimal(ownerContext, {
      farmId,
      visualId: "BR-1004",
      sex: "female",
      rfid: "982000000001004",
    });
    const replaced = await registry.replaceIdentifier(ownerContext, {
      animalId: animal.id,
      identifierType: "rfid",
      newValue: "982000000009004",
      reason: "tag damaged",
    });
    expect(replaced.identifierValue).toBe("982000000009004");
    expect(replaced.validTo).toBeNull();

    // Identity is unchanged; new RFID resolves, old RFID no longer active.
    expect((await registry.resolveRfid(ownerContext, "982000000009004"))?.id).toBe(
      animal.id,
    );
    expect(await registry.resolveRfid(ownerContext, "982000000001004")).toBeNull();

    // The old assignment still exists as closed history + a replacement event.
    const history = await db.adminPool.query(
      `SELECT valid_to FROM animal_identifier
       WHERE animal_id = $1 AND identifier_type = 'rfid' AND identifier_value = '982000000001004'`,
      [animal.id],
    );
    expect(history.rows[0].valid_to).not.toBeNull();
    const timeline = await registry.getTimeline(ownerContext, animal.id);
    expect(timeline.some((e) => e.eventType === "animal.identifier_replaced.v1")).toBe(
      true,
    );

    // The freed RFID can now be assigned to another animal.
    const other = await registry.registerAnimal(ownerContext, {
      farmId,
      visualId: "BR-1005",
      sex: "male",
    });
    const reassigned = await registry.assignIdentifier(ownerContext, {
      animalId: other.id,
      identifierType: "rfid",
      identifierValue: "982000000001004",
    });
    expect(reassigned.identifierValue).toBe("982000000001004");
  });

  it("denies a non-herd role from registering (403), and audits the denial", async () => {
    // Invite + activate a finance_user (not a herd role).
    const invite = await identity.inviteUser(ownerContext, {
      email: "finance@example.com",
      displayName: "Finance",
      role: "finance_user",
    });
    await identity.activateMembership(ownerContext, {
      userId: invite.userId,
      role: "finance_user",
    });
    const financeContext = makeTenantContext(tenantId, invite.userId);

    await expect(
      registry.registerAnimal(financeContext, {
        farmId,
        visualId: "BR-NO",
        sex: "female",
      }),
    ).rejects.toBeInstanceOf(AnimalForbiddenError);

    const denials = await db.adminPool.query(
      `SELECT count(*)::int AS n FROM audit_record
       WHERE tenant_id = $1 AND outcome = 'denied' AND action LIKE 'animal.%'`,
      [tenantId],
    );
    expect(denials.rows[0].n).toBeGreaterThan(0);
  });

  it("rejects registering under a missing farm", async () => {
    await expect(
      registry.registerAnimal(ownerContext, {
        farmId: "00000000-0000-4000-8000-0000000000ee",
        visualId: "BR-NF",
        sex: "male",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not leak animals across tenants", async () => {
    const other = await seedTenantWithOwner(
      identity,
      "Outra Fazenda",
      "outro@example.com",
    );
    const animals = await registry.listAnimals(other.ownerContext);
    expect(animals).toHaveLength(0);
  });
});

describe.skipIf(available)("AnimalRegistryService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
