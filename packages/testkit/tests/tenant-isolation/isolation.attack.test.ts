import {
  assertSameTenant,
  createEventEnvelope,
  createTenantContext,
  newUuid,
  TenantIsolationError,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import { appendEvent, withTenantTransaction } from "@jk/database";
import { ForbiddenError, type IdentityService } from "@jk/identity-tenancy";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  databaseAvailable,
  type TestDatabase,
} from "../../src/pg-harness.js";
import {
  makeIdentityService,
  makeTenantContext,
  seedTenantWithOwner,
  type SeededTenant,
} from "../../src/fixtures.js";

/**
 * Cross-tenant isolation attack suite (JK-PLT-EES-001 §67, §81 scenario 10,
 * §83). For every Phase-0 interface, a principal of tenant B attempts to reach
 * tenant A's data and MUST be denied. Zero cross-tenant exposure is tolerated
 * (§5 success measure: "Tenant isolation — Zero").
 *
 * Trust boundary (ADR-012): `app.tenant_id` is set server-side by the platform
 * from a validated membership, never chosen by a client. Tests therefore treat
 * "reads succeed when the setting IS the tenant" as the accepted boundary and
 * attack the layers that must hold even so: a correctly-scoped B context, RLS
 * WITH CHECK on writes, the application authorization policy, the event/outbox
 * path, worker projections, and the fail-closed empty context.
 */

const available = databaseAvailable();

describe.skipIf(!available)("cross-tenant isolation attack suite", () => {
  let db: TestDatabase;
  let service: IdentityService;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase("jk_isolation");
    service = makeIdentityService(db);
    tenantA = await seedTenantWithOwner(service, "Fazenda Aurora", "ana@example.com");
    tenantB = await seedTenantWithOwner(service, "Rancho Boa Vista", "bruno@example.com");
    // Give tenant A a farm to try to steal.
    await service.createFarm(tenantA.ownerContext, { name: "Sede Aurora", areaHa: 100 });
    await service.createFarm(tenantB.ownerContext, {
      name: "Sede Boa Vista",
      areaHa: 80,
    });
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  // --- SQL / RLS layer (jk_app role) ---------------------------------------

  describe("SQL / RLS layer (jk_app)", () => {
    const tables = [
      "farm",
      "animal",
      "paddock",
      "domain_event",
      "outbox_message",
      "tenant_membership",
    ];

    it("a correctly-scoped B context sees none of A's rows", async () => {
      for (const table of tables) {
        const rows = await withTenantTransaction(
          db.appPool,
          tenantB.ownerContext,
          (client) => client.query(`SELECT * FROM ${table}`),
        );
        const foreign = rows.rows.filter(
          (r: Record<string, unknown>) => r.tenant_id === tenantA.tenantId,
        );
        expect(foreign, `table ${table} leaked tenant A rows to B`).toHaveLength(0);
      }
    });

    it("B cannot INSERT a row bearing A's tenant_id (RLS WITH CHECK)", async () => {
      await expect(
        withTenantTransaction(db.appPool, tenantB.ownerContext, (client) =>
          client.query(`INSERT INTO farm (tenant_id, name) VALUES ($1, 'Invasora')`, [
            tenantA.tenantId,
          ]),
        ),
      ).rejects.toThrow(/row-level security|violates/i);
    });

    it("B cannot UPDATE A's farm (0 rows affected under B's scope)", async () => {
      const result = await withTenantTransaction(
        db.appPool,
        tenantB.ownerContext,
        (client) =>
          client.query(`UPDATE farm SET name = 'Roubada' WHERE tenant_id = $1`, [
            tenantA.tenantId,
          ]),
      );
      expect(result.rowCount).toBe(0);
    });

    it("an empty tenant context reads nothing (fail closed)", async () => {
      const client = await db.appPool.connect();
      try {
        for (const table of ["farm", "tenant", "domain_event"]) {
          const result = await client.query(`SELECT * FROM ${table}`);
          expect(result.rows, `table ${table} not fail-closed`).toHaveLength(0);
        }
      } finally {
        client.release();
      }
    });
  });

  // --- Application layer (IdentityService) ---------------------------------

  describe("application layer", () => {
    it("B's owner reading with B context never returns A's farms", async () => {
      const farms = await service.listFarms(tenantB.ownerContext);
      expect(farms.every((f) => f.tenantId === tenantB.tenantId)).toBe(true);
      expect(farms.some((f) => f.name === "Sede Aurora")).toBe(false);
    });

    it("B's user selecting tenant A is denied (no membership → 403)", async () => {
      // Simulate a client forging x-tenant-id: A's tenant id, B's user identity.
      const forged: TenantContext = makeTenantContext(
        tenantA.tenantId,
        tenantB.ownerUserId,
      );
      await expect(service.listFarms(forged)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.getTenant(forged)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        service.createFarm(forged, { name: "Contrabando" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("records the denial in the audit stream with a reason (§66, §68)", async () => {
      const forged = makeTenantContext(tenantA.tenantId, tenantB.ownerUserId);
      await service.listFarms(forged).catch(() => {});
      // Audit rows for tenant A are visible only under A's scope.
      const audits = await withTenantTransaction(
        db.appPool,
        tenantA.ownerContext,
        (client) =>
          client.query<{ outcome: string; detail: { reason?: string } }>(
            `SELECT outcome, detail FROM audit_record WHERE outcome = 'denied'`,
          ),
      );
      expect(audits.rows.length).toBeGreaterThan(0);
      expect(audits.rows.some((r) => typeof r.detail?.reason === "string")).toBe(true);
    });
  });

  // --- Event / outbox layer ------------------------------------------------

  describe("event and outbox layer", () => {
    it("appendEvent bearing A's tenant id inside a B transaction is rejected", async () => {
      // Build a well-formed envelope for tenant A, then try to write it while
      // the transaction is scoped to tenant B (app.tenant_id = B).
      const envelopeForA = createEventEnvelope({
        eventType: "identity.farm_created.v1",
        context: tenantA.ownerContext,
        aggregateType: "farm",
        aggregateId: newUuid(),
        aggregateVersion: 1,
        source: { channel: "api" },
        idempotencyKey: `attack-${newUuid()}`,
        payload: { name: "Evento Forjado" },
      });
      await expect(
        withTenantTransaction(db.appPool, tenantB.ownerContext, (client) =>
          appendEvent(client, envelopeForA),
        ),
      ).rejects.toThrow(/row-level security|violates/i);
    });
  });

  // --- Worker / projection layer -------------------------------------------

  describe("worker / projection layer", () => {
    it("B cannot read A's projection_event_stats rows", async () => {
      // Ensure at least one stats row exists for A via a direct upsert as the
      // worker role (cross-tenant by design), then confirm B cannot see it.
      const workerClient = await db.workerPool.connect();
      try {
        await workerClient.query(
          `INSERT INTO projection_event_stats (tenant_id, aggregate_type, event_count, last_event_at)
           VALUES ($1, 'farm', 1, now())
           ON CONFLICT (tenant_id, aggregate_type)
           DO UPDATE SET event_count = projection_event_stats.event_count + 1`,
          [tenantA.tenantId],
        );
      } finally {
        workerClient.release();
      }
      const visibleToB = await withTenantTransaction(
        db.appPool,
        tenantB.ownerContext,
        (client) => client.query(`SELECT * FROM projection_event_stats`),
      );
      expect(
        visibleToB.rows.some(
          (r: Record<string, unknown>) => r.tenant_id === tenantA.tenantId,
        ),
      ).toBe(false);
    });
  });

  // --- Kernel guard --------------------------------------------------------

  describe("assertSameTenant guard (defense in depth, §67)", () => {
    it("throws TenantIsolationError on an envelope/context tenant mismatch", () => {
      const ctxA = createTenantContext({
        tenantId: tenantA.tenantId,
        actor: { type: "service", id: "consumer" },
        correlationId: newUuid(),
      });
      expect(() => assertSameTenant(ctxA, tenantB.tenantId as Uuid)).toThrow(
        TenantIsolationError,
      );
      expect(() => assertSameTenant(ctxA, tenantA.tenantId)).not.toThrow();
    });
  });
});

describe.skipIf(available)(
  "cross-tenant isolation attack suite (PostgreSQL unavailable)",
  () => {
    it("skips when no database is reachable", () => {
      expect(true).toBe(true);
    });
  },
);
