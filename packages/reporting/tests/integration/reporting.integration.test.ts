import { NotFoundError, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  makeTenantContext,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ReportingForbiddenError,
  ReportingService,
  UnknownReportError,
} from "../../src/index.js";

const available = databaseAvailable();

describe.skipIf(!available)("ReportingService (integration)", () => {
  let db: TestDatabase;
  let reporting: ReportingService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_reporting");
    identity = makeIdentityService(db);
    reporting = new ReportingService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Rel",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 300 });
    farmId = farm.id;
    // Two animals and two financial entries so reports have real rows.
    await db.adminPool.query(
      `INSERT INTO animal (tenant_id, farm_id, visual_id, sex) VALUES
         ($1,$2,'JQ-0001','female'), ($1,$2,'JQ-0002','male')`,
      [tenantId, farmId],
    );
    await db.adminPool.query(
      `INSERT INTO financial_entry (tenant_id, farm_id, entry_type, category, amount_minor)
       VALUES ($1,$2,'revenue','cattle_sale',500000), ($1,$2,'expense','feed',120000)`,
      [tenantId, farmId],
    );
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("lists the catalogue for an active member", async () => {
    const reports = await reporting.listReports(owner);
    expect(reports.length).toBeGreaterThanOrEqual(8);
    expect(reports.map((r) => r.key)).toContain("herd.inventory");
  });

  it("previews a report without recording a run", async () => {
    const preview = await reporting.previewReport(owner, { reportKey: "herd.inventory" });
    expect(preview.rowCount).toBe(2);
    expect(preview.summary.total).toBe(2);
    const runs = await db.adminPool.query(`SELECT count(*)::int AS c FROM report_run`);
    expect(runs.rows[0].c).toBe(0);
  });

  it("runReport records an append-only snapshot and emits an event", async () => {
    const result = await reporting.runReport(owner, { reportKey: "finance.pl" });
    expect(result.rowCount).toBe(2);
    expect(result.summary.marginMinor).toBe(380000);

    const row = await db.adminPool.query(
      `SELECT report_key, row_count, checksum, event_id FROM report_run WHERE id = $1`,
      [result.id],
    );
    expect(row.rows[0].report_key).toBe("finance.pl");
    expect(row.rows[0].checksum).toBe(result.checksum);
    expect(row.rows[0].event_id).toBeTruthy();

    const events = await db.adminPool.query(
      `SELECT payload FROM domain_event WHERE aggregate_id = $1 AND event_type = 'reporting.report_generated.v1'`,
      [result.id],
    );
    expect(events.rows).toHaveLength(1);

    const reopened = await reporting.getRun(owner, result.id);
    expect(reopened.rows).toHaveLength(2);
    expect(reopened.checksum).toBe(result.checksum);

    const csv = await reporting.downloadRunCsv(owner, result.id);
    expect(csv.content.split("\n")[0]).toBe("entryType,category,totalMinor");
  });

  it("is append-only: report_run rejects UPDATE and DELETE", async () => {
    const result = await reporting.runReport(owner, { reportKey: "herd.inventory" });
    await expect(
      db.adminPool.query(`UPDATE report_run SET row_count = 0 WHERE id = $1`, [
        result.id,
      ]),
    ).rejects.toThrow();
    await expect(
      db.adminPool.query(`DELETE FROM report_run WHERE id = $1`, [result.id]),
    ).rejects.toThrow();
  });

  it("every catalogue report previews without a SQL error", async () => {
    const catalogue = await reporting.listReports(owner);
    for (const report of catalogue) {
      const preview = await reporting.previewReport(owner, { reportKey: report.key });
      expect(preview.reportKey).toBe(report.key);
      expect(Array.isArray(preview.rows)).toBe(true);
    }
  });

  it("rejects an unknown report", async () => {
    await expect(
      reporting.previewReport(owner, { reportKey: "nope.nope" }),
    ).rejects.toBeInstanceOf(UnknownReportError);
  });

  it("denies a caller with no active membership", async () => {
    const stranger = makeTenantContext(tenantId);
    await expect(
      reporting.previewReport(stranger, { reportKey: "herd.inventory" }),
    ).rejects.toBeInstanceOf(ReportingForbiddenError);
  });

  it("does not leak runs or snapshots across tenants", async () => {
    const mine = await reporting.runReport(owner, { reportKey: "herd.inventory" });
    const other = await seedTenantWithOwner(identity, "Outra", "o2@example.com");

    const theirRuns = await reporting.listRuns(other.ownerContext, {});
    expect(theirRuns).toEqual([]);

    await expect(reporting.getRun(other.ownerContext, mine.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe.skipIf(available)("ReportingService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
