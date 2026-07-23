import { newUuid, ValidationError, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  makeTenantContext,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExportService } from "../../src/export-service.js";
import { AnalyticsForbiddenError } from "../../src/errors.js";

const available = databaseAvailable();

async function seedAnimal(db: TestDatabase, tenantId: Uuid, farmId: Uuid): Promise<Uuid> {
  const id = newUuid();
  await db.adminPool.query(
    `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, breed_code, version) VALUES ($1,$2,$3,'A-1','female','BRANGUS',0)`,
    [id, tenantId, farmId],
  );
  await db.adminPool.query(
    `INSERT INTO animal_identifier (id, tenant_id, animal_id, identifier_type, identifier_value, valid_from)
     VALUES ($1,$2,$3,'rfid','982000000099001', now())`,
    [newUuid(), tenantId, id],
  );
  await db.adminPool.query(
    `INSERT INTO animal_weight (tenant_id, animal_id, occurred_at, weight_kg, eligible_for_analytics, event_id)
     VALUES ($1,$2, now(), 305.5, true, $3)`,
    [tenantId, id, `e-${newUuid()}`],
  );
  await db.adminPool.query(
    `INSERT INTO animal_restriction (tenant_id, animal_id, restriction_type, reason, valid_from, status)
     VALUES ($1,$2,'withdrawal','vaccine withdrawal', now(), 'active')`,
    [tenantId, id],
  );
  return id;
}

describe.skipIf(!available)("ExportService (integration)", () => {
  let db: TestDatabase;
  let exports: ExportService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let animalId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_exports");
    identity = makeIdentityService(db);
    exports = new ExportService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(identity, "Fazenda Export", "owner@example.com");
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    animalId = await seedAnimal(db, tenantId, farm.id);
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("runs the async export lifecycle: request → process → download (§27)", async () => {
    const job = await exports.requestExport(owner, {
      exportType: "animal_traceability_packet",
      format: "json",
      params: { animalId },
    });
    expect(job.status).toBe("pending");
    expect(job.resolvableUrl).toContain(job.id);

    const processed = await exports.processExport(owner, job.id);
    expect(processed.status).toBe("completed");
    expect(processed.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(processed.byteSize).toBeGreaterThan(0);

    const download = await exports.downloadExport(owner, job.id);
    const packet = JSON.parse(download.content);
    expect(packet.animal.breed_code).toBe("BRANGUS");
    expect(packet.identifiers).toHaveLength(1);
    expect(packet.weights[0].weight_kg).toBe("305.5");
    expect(packet.restrictions[0].restriction_type).toBe("withdrawal");

    // Every request/complete/download is audited (§27).
    const audit = await db.adminPool.query(
      `SELECT action FROM export_access_log WHERE export_job_id = $1 ORDER BY recorded_at`,
      [job.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["requested", "completed", "downloaded"]);
  });

  it("renders a CSV traceability packet (JK-ANI-006)", async () => {
    const job = await exports.requestExport(owner, {
      exportType: "animal_traceability_packet",
      format: "csv",
      params: { animalId },
    });
    await exports.processExport(owner, job.id);
    const download = await exports.downloadExport(owner, job.id);
    expect(download.format).toBe("csv");
    expect(download.content).toContain("# animal");
    expect(download.content).toContain("# weights");
  });

  it("requires animalId for a traceability packet", async () => {
    await expect(
      exports.requestExport(owner, { exportType: "animal_traceability_packet", format: "json", params: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to download an expired export and marks it expired (§27)", async () => {
    const job = await exports.requestExport(owner, { exportType: "animal_inventory", format: "json", params: {} });
    await exports.processExport(owner, job.id);
    // Force expiry in the past.
    await db.adminPool.query(`UPDATE export_job SET expires_at = now() - interval '1 hour' WHERE id = $1`, [job.id]);
    await expect(exports.downloadExport(owner, job.id)).rejects.toBeInstanceOf(ValidationError);
    const after = await exports.getExportJob(owner, job.id);
    expect(after.status).toBe("expired");
  });

  it("denies export to a caller with no active membership", async () => {
    const stranger = makeTenantContext(tenantId, newUuid());
    await expect(
      exports.requestExport(stranger, { exportType: "animal_inventory", format: "json", params: {} }),
    ).rejects.toBeInstanceOf(AnalyticsForbiddenError);
  });

  it("does not leak exports across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    await expect(exports.listExportJobs(other.ownerContext)).resolves.toEqual([]);
  });
});

describe.skipIf(available)("ExportService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
