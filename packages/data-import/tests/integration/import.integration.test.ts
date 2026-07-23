import { newUuid, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  makeTenantContext,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImportService } from "../../src/import-service.js";
import { ImportForbiddenError, ImportStateError } from "../../src/errors.js";
import type { RowExecutor } from "../../src/domain.js";

const available = databaseAvailable();

/** A CSV with: one valid new row, one duplicate of an existing animal, one
 *  invalid sex, and one duplicate within the file. */
const CSV = [
  "tag,gender,breed,born",
  "BR-9001,female,BRANGUS,2024-05-01",
  "BR-0001,male,BRANGUS,2023-01-01", // BR-0001 already exists → duplicate
  "BR-9002,hembra,BRANGUS,2024-06-01", // invalid sex
  "BR-9001,male,BRANGUS,2024-07-01", // duplicate within file
].join("\n");

const MAPPING = { visualId: "tag", sex: "gender", breedCode: "breed", birthDate: "born" };

describe.skipIf(!available)("ImportService staged workflow (integration)", () => {
  let db: TestDatabase;
  let imports: ImportService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_import");
    identity = makeIdentityService(db);
    imports = new ImportService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(identity, "Fazenda Import", "owner@example.com");
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    farmId = farm.id;
    // Existing animal to trigger the "already exists" duplicate.
    await db.adminPool.query(
      `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, breed_code, version) VALUES ($1,$2,$3,'BR-0001','female','BRANGUS',0)`,
      [newUuid(), tenantId, farmId],
    );
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("runs upload → parse → map → validate → preview → execute → reconcile", async () => {
    const created: string[] = [];
    const executor: RowExecutor = async (row, ctx) => {
      // The API composition root supplies this; here it stands in for the
      // animal-registry service. Records the farm scope and a fake server id.
      expect(ctx.farmId).toBe(farmId);
      const serverId = newUuid();
      created.push(row.visualId);
      return { status: "created", serverId };
    };

    const uploaded = await imports.upload(owner, { importType: "animals", filename: "herd.csv", content: CSV, farmId });
    expect(uploaded.status).toBe("uploaded");

    await imports.parse(owner, uploaded.id);
    await imports.map(owner, uploaded.id, MAPPING);
    const validated = await imports.validate(owner, uploaded.id);
    expect(validated.totalRows).toBe(4);
    expect(validated.validRows).toBe(1); // only BR-9001 (first occurrence)
    expect(validated.duplicateRows).toBe(2); // BR-0001 (in db) + BR-9001 (in file)
    expect(validated.invalidRows).toBe(1); // invalid sex

    const preview = await imports.preview(owner, uploaded.id);
    expect(preview.sample).toHaveLength(1);
    expect(preview.sample[0]!.mapped!.visualId).toBe("BR-9001");
    expect(preview.invalidSample.length).toBe(3);

    const executed = await imports.execute(owner, uploaded.id, executor);
    expect(executed.status).toBe("executed");
    expect(executed.executedRows).toBe(1);
    expect(executed.failedRows).toBe(0);
    expect(created).toEqual(["BR-9001"]); // only the valid row was written

    const reconciled = await imports.reconcile(owner, uploaded.id);
    expect(reconciled.job.status).toBe("reconciled");
    expect(reconciled.sample[0]!.executionStatus).toBe("created");

    // Raw upload preserved verbatim as evidence (§27).
    const evidence = await db.adminPool.query(`SELECT raw_content, raw_checksum FROM import_job WHERE id = $1`, [uploaded.id]);
    expect(evidence.rows[0].raw_content).toBe(CSV);
    expect(evidence.rows[0].raw_checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to execute before validation (stage order)", async () => {
    const uploaded = await imports.upload(owner, { importType: "animals", content: "tag,gender\nBR-8000,female", farmId });
    await imports.parse(owner, uploaded.id);
    await expect(imports.execute(owner, uploaded.id, async () => ({ status: "created" }))).rejects.toBeInstanceOf(ImportStateError);
  });

  it("denies import to a non-management role (finance_user)", async () => {
    const invite = await identity.inviteUser(owner, { email: "fin@example.com", displayName: "Fin", role: "finance_user" });
    await identity.activateMembership(owner, { userId: invite.userId, role: "finance_user" });
    const fin = makeTenantContext(tenantId, invite.userId);
    await expect(imports.upload(fin, { importType: "animals", content: "tag\nX" })).rejects.toBeInstanceOf(ImportForbiddenError);
  });

  it("does not leak imports across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    await expect(imports.listJobs(other.ownerContext)).resolves.toEqual([]);
  });
});

describe.skipIf(available)("ImportService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
