import { newUuid, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchService } from "../../src/search-service.js";

const available = databaseAvailable();

describe.skipIf(!available)("SearchService (integration)", () => {
  let db: TestDatabase;
  let search: SearchService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_search");
    identity = makeIdentityService(db);
    search = new SearchService({ appPool: db.appPool });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Busca",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    farmId = farm.id;

    const animalId = newUuid();
    await db.adminPool.query(
      `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, breed_code, version)
       VALUES ($1,$2,$3,'BR-SRCH-01','female','BRANGUS',0)`,
      [animalId, tenantId, farmId],
    );
    await db.adminPool.query(
      `INSERT INTO animal_identifier (id, tenant_id, animal_id, identifier_type, identifier_value, valid_from)
       VALUES ($1,$2,$3,'rfid','982000000SEARCH', now())`,
      [newUuid(), tenantId, animalId],
    );
    await db.adminPool.query(
      `INSERT INTO lot (tenant_id, farm_id, name, purpose) VALUES ($1,$2,'Lote Busca','beef')`,
      [tenantId, farmId],
    );
    await db.adminPool.query(
      `INSERT INTO paddock (tenant_id, farm_id, name) VALUES ($1,$2,'Piquete Busca')`,
      [tenantId, farmId],
    );
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("finds an animal by visual id", async () => {
    const r = await search.search(owner, "SRCH");
    expect(r.animals.map((a) => a.label)).toContain("BR-SRCH-01");
  });

  it("finds an animal by RFID identifier", async () => {
    const r = await search.search(owner, "982000000SEARCH");
    expect(r.animals).toHaveLength(1);
    expect(r.animals[0]!.sublabel).toContain("RFID");
  });

  it("finds lots and paddocks by name", async () => {
    const r = await search.search(owner, "Busca");
    expect(r.lots.map((l) => l.label)).toContain("Lote Busca");
    expect(r.paddocks.map((p) => p.label)).toContain("Piquete Busca");
  });

  it("finds people among the tenant's members", async () => {
    const r = await search.search(owner, "owner@example.com");
    expect(r.people.length).toBeGreaterThanOrEqual(1);
    expect(r.people[0]!.type).toBe("person");
  });

  it("treats LIKE wildcards literally", async () => {
    const r = await search.search(owner, "%");
    expect(r.animals).toHaveLength(0);
    expect(r.lots).toHaveLength(0);
  });

  it("returns empty for a blank query", async () => {
    const r = await search.search(owner, "   ");
    expect(r.animals).toHaveLength(0);
  });

  it("does not leak results across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    const r = await search.search(other.ownerContext, "Busca");
    expect(r.lots).toHaveLength(0);
    expect(r.paddocks).toHaveLength(0);
    expect(r.animals).toHaveLength(0);
  });
});

describe.skipIf(available)("SearchService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
