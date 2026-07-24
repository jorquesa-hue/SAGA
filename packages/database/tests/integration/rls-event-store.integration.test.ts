import {
  createTenantContext,
  createEventEnvelope,
  IdempotencyConflictError,
  ConcurrencyConflictError,
  newUuid,
} from "@jk/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTransaction, withSystemTransaction } from "../../src/client.js";
import { appendEvent, subjectForEvent } from "../../src/event-store.js";
import { createTestDatabase, databaseAvailable, type TestDatabase } from "./setup.js";

const available = databaseAvailable();

describe.skipIf(!available)(
  "RLS tenant isolation + event store (real PostgreSQL)",
  () => {
    let db: TestDatabase;
    let tenantA: string;
    let tenantB: string;

    const contextFor = (tenantId: string) =>
      createTenantContext({
        tenantId,
        actor: { type: "user", id: newUuid(), display: "Técnico" },
        correlationId: newUuid(),
      });

    beforeAll(async () => {
      db = await createTestDatabase("jk_rls");
      // Tenant onboarding is a system-level operation (owner connection).
      const rows = await withSystemTransaction(db.adminPool, async (client) => {
        const a = await client.query(
          `INSERT INTO tenant (name, status) VALUES ('Fazenda Aurora', 'active') RETURNING id`,
        );
        const b = await client.query(
          `INSERT INTO tenant (name, status) VALUES ('Rancho Boa Vista', 'active') RETURNING id`,
        );
        return { a: a.rows[0].id as string, b: b.rows[0].id as string };
      });
      tenantA = rows.a;
      tenantB = rows.b;
    }, 60_000);

    afterAll(async () => {
      await db?.destroy();
    });

    it("app role sees only the active tenant's rows (JK-SEC-004/005)", async () => {
      await withTenantTransaction(db.appPool, contextFor(tenantA), async (client) => {
        await client.query(
          `INSERT INTO farm (tenant_id, name, area_ha) VALUES ($1, 'Sede', 100)`,
          [tenantA],
        );
      });

      // Tenant B sees nothing of tenant A.
      const fromB = await withTenantTransaction(
        db.appPool,
        contextFor(tenantB),
        (client) => client.query("SELECT * FROM farm"),
      );
      expect(fromB.rows).toHaveLength(0);

      const tenantsVisibleToB = await withTenantTransaction(
        db.appPool,
        contextFor(tenantB),
        (client) => client.query("SELECT id FROM tenant"),
      );
      expect(tenantsVisibleToB.rows.map((r) => r.id)).toEqual([tenantB]);
    });

    it("blocks cross-tenant INSERT even when application code lies (RLS WITH CHECK)", async () => {
      await expect(
        withTenantTransaction(db.appPool, contextFor(tenantB), (client) =>
          client.query(`INSERT INTO farm (tenant_id, name) VALUES ($1, 'Invasora')`, [
            tenantA,
          ]),
        ),
      ).rejects.toThrow(/row-level security|violates/i);
    });

    it("app role without tenant context sees nothing (fail-closed)", async () => {
      const client = await db.appPool.connect();
      try {
        const result = await client.query("SELECT * FROM farm");
        expect(result.rows).toHaveLength(0);
      } finally {
        client.release();
      }
    });

    it("appends events atomically with the outbox and replays idempotently", async () => {
      const context = contextFor(tenantA);
      const aggregateId = newUuid();
      const envelope = createEventEnvelope({
        eventType: "identity.farm_created.v1",
        context,
        aggregateType: "farm",
        aggregateId,
        aggregateVersion: 1,
        source: { channel: "api" },
        idempotencyKey: `farm-create-${aggregateId}`,
        payload: { name: "Sede Nova" },
      });

      const first = await withTenantTransaction(db.appPool, context, (client) =>
        appendEvent(client, envelope),
      );
      expect(first.deduplicated).toBe(false);

      // Replay with same idempotency key + same payload → deduplicated, no new row.
      const replay = await withTenantTransaction(db.appPool, context, (client) =>
        appendEvent(client, envelope),
      );
      expect(replay).toEqual({ eventId: envelope.eventId, deduplicated: true });

      const count = await withTenantTransaction(db.appPool, context, (client) =>
        client.query(
          `SELECT count(*)::int AS n FROM domain_event WHERE aggregate_id = $1`,
          [aggregateId],
        ),
      );
      expect(count.rows[0].n).toBe(1);

      // Same key, different payload → explicit conflict (never silent).
      await expect(
        withTenantTransaction(db.appPool, context, (client) =>
          appendEvent(client, { ...envelope, payload: { name: "Outra" } }),
        ),
      ).rejects.toThrow(IdempotencyConflictError);

      // Same aggregate version from a concurrent writer → concurrency conflict.
      const conflicting = createEventEnvelope({
        eventType: "identity.farm_created.v1",
        context,
        aggregateType: "farm",
        aggregateId,
        aggregateVersion: 1,
        source: { channel: "api" },
        idempotencyKey: `farm-create-conflict-${aggregateId}`,
        payload: { name: "Concorrente" },
      });
      await expect(
        withTenantTransaction(db.appPool, context, (client) =>
          appendEvent(client, conflicting),
        ),
      ).rejects.toThrow(ConcurrencyConflictError);
    });

    it("event subjects follow §49 and never contain the tenant id", () => {
      const context = contextFor(tenantA);
      const envelope = createEventEnvelope({
        eventType: "animal.weight_recorded.v1",
        context,
        aggregateType: "animal",
        aggregateId: newUuid(),
        aggregateVersion: 1,
        source: { channel: "edge" },
        idempotencyKey: newUuid(),
        payload: { weightKilograms: 301 },
      });
      const subject = subjectForEvent(envelope, "prod");
      expect(subject).toBe("jk.prod.a1.animal.animal.weight-recorded.v1");
      expect(subject).not.toContain(tenantA);
    });

    it("worker role reads the outbox across tenants but app role cannot", async () => {
      // The app role, under tenant B, must not see tenant A outbox rows.
      const fromB = await withTenantTransaction(
        db.appPool,
        contextFor(tenantB),
        (client) => client.query("SELECT tenant_id FROM outbox_message"),
      );
      expect(fromB.rows.every((r) => r.tenant_id === tenantB)).toBe(true);

      // The worker role (scoped cross-tenant policies) sees pending messages.
      const workerClient = await db.workerPool.connect();
      try {
        const pending = await workerClient.query(
          "SELECT tenant_id FROM outbox_message WHERE published_at IS NULL",
        );
        expect(pending.rows.length).toBeGreaterThan(0);
        expect(pending.rows.some((r) => r.tenant_id === tenantA)).toBe(true);
      } finally {
        workerClient.release();
      }
    });

    it("worker role cannot touch business tables (least privilege, JK-IAM-006)", async () => {
      const workerClient = await db.workerPool.connect();
      try {
        await expect(workerClient.query("SELECT * FROM farm")).rejects.toThrow(
          /permission denied/i,
        );
        await expect(
          workerClient.query("INSERT INTO domain_event (event_id) VALUES ('X')"),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        workerClient.release();
      }
    });
  },
);

describe.skipIf(available)("RLS suite (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
