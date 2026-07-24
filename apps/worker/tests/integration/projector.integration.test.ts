import {
  createEventEnvelope,
  createTenantContext,
  newUuid,
  type DomainEventEnvelope,
} from "@jk/domain-kernel";
import { appendEvent, withSystemTransaction, withTenantTransaction } from "@jk/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OutboxRelay } from "../../src/outbox-relay.js";
import { EVENT_STATS_CONSUMER, EventStatsProjector } from "../../src/projector.js";
import { InMemoryPublisher } from "../../src/publisher.js";
import { createTestDatabase, databaseAvailable, type TestDatabase } from "./setup.js";

const available = databaseAvailable();

describe.skipIf(!available)("event stats projector (§31.2, §42, real PostgreSQL)", () => {
  let db: TestDatabase;
  let tenantA: string;
  let tenantB: string;

  const contextFor = (tenantId: string) =>
    createTenantContext({
      tenantId,
      actor: { type: "user", id: newUuid(), display: "Veterinária Boa Vista" },
      correlationId: newUuid(),
    });

  function buildEnvelope(
    tenantId: string,
    eventType: string,
    aggregateType: string,
    payload: Record<string, unknown>,
  ): DomainEventEnvelope {
    const aggregateId = newUuid();
    return createEventEnvelope({
      eventType,
      context: contextFor(tenantId),
      aggregateType,
      aggregateId,
      aggregateVersion: 1,
      source: { channel: "api" },
      idempotencyKey: `${aggregateType}-${aggregateId}`,
      payload,
    });
  }

  async function append(envelope: DomainEventEnvelope): Promise<void> {
    await withTenantTransaction(db.appPool, contextFor(envelope.tenantId), (client) =>
      appendEvent(client, envelope),
    );
  }

  async function statsRows(): Promise<
    Array<{
      tenant_id: string;
      aggregate_type: string;
      event_count: string;
      last_event_at: Date | null;
      calculated_at: Date;
    }>
  > {
    const { rows } = await db.adminPool.query(
      `SELECT tenant_id, aggregate_type, event_count, last_event_at, calculated_at
         FROM projection_event_stats
        ORDER BY tenant_id, aggregate_type`,
    );
    return rows;
  }

  beforeAll(async () => {
    db = await createTestDatabase("jk_proj");
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

  it("relay pipeline feeds the projector; stats count per tenant and aggregate type", async () => {
    await append(
      buildEnvelope(tenantA, "identity.farm_created.v1", "farm", { name: "Sede" }),
    );
    await append(
      buildEnvelope(tenantA, "identity.farm_created.v1", "farm", {
        name: "Retiro do Ipê",
      }),
    );
    await append(
      buildEnvelope(tenantA, "identity.user_invited.v1", "user", {
        email: "tecnico@fazenda-aurora.example",
        role: "technician",
      }),
    );
    await append(
      buildEnvelope(tenantB, "identity.farm_created.v1", "farm", {
        name: "Invernada Norte",
      }),
    );

    const publisher = new InMemoryPublisher();
    const projector = new EventStatsProjector();
    const relay = new OutboxRelay({ pool: db.workerPool, publisher, projector });

    const run = await relay.runOnce();
    expect(run).toMatchObject({ polled: 4, published: 4, failed: 0, projected: 4 });

    const stats = await statsRows();
    expect(stats).toHaveLength(3);
    const counts = new Map(
      stats.map((r) => [`${r.tenant_id}/${r.aggregate_type}`, Number(r.event_count)]),
    );
    expect(counts.get(`${tenantA}/farm`)).toBe(2);
    expect(counts.get(`${tenantA}/user`)).toBe(1);
    expect(counts.get(`${tenantB}/farm`)).toBe(1);
    for (const row of stats) {
      // §42: every projection exposes calculated_at and its source checkpoint.
      expect(row.calculated_at).toBeInstanceOf(Date);
      expect(row.last_event_at).toBeInstanceOf(Date);
    }

    const processed = await db.adminPool.query(
      `SELECT consumer_name, message_id FROM processed_message ORDER BY message_id`,
    );
    expect(processed.rows).toHaveLength(4);
    expect(processed.rows.every((r) => r.consumer_name === EVENT_STATS_CONSUMER)).toBe(
      true,
    );
    expect(processed.rows.map((r) => r.message_id).sort()).toEqual(
      publisher.eventIds().sort(),
    );
  });

  it("a second relay run neither republishes nor reprojects", async () => {
    const publisher = new InMemoryPublisher();
    const relay = new OutboxRelay({
      pool: db.workerPool,
      publisher,
      projector: new EventStatsProjector(),
    });
    const run = await relay.runOnce();
    expect(run).toMatchObject({ polled: 0, published: 0, projected: 0 });
    const stats = await statsRows();
    expect(stats.reduce((sum, r) => sum + Number(r.event_count), 0)).toBe(4);
  });

  it("is idempotent: the same envelope fed twice counts exactly once (§31.2)", async () => {
    const projector = new EventStatsProjector();
    const envelope = buildEnvelope(tenantB, "identity.user_invited.v1", "user", {
      email: "auditora@rancho-boa-vista.example",
      role: "auditor",
    });

    const first = await projector.projectWithPool(db.workerPool, envelope);
    expect(first.applied).toBe(true);
    const redelivery = await projector.projectWithPool(db.workerPool, envelope);
    expect(redelivery.applied).toBe(false);

    const { rows } = await db.adminPool.query(
      `SELECT event_count FROM projection_event_stats WHERE tenant_id = $1 AND aggregate_type = 'user'`,
      [tenantB],
    );
    expect(Number(rows[0].event_count)).toBe(1);
  });

  it("refreshes calculated_at and last_event_at on each applied event (§42)", async () => {
    const before = await db.adminPool.query(
      `SELECT event_count, calculated_at FROM projection_event_stats
        WHERE tenant_id = $1 AND aggregate_type = 'farm'`,
      [tenantB],
    );
    const envelope = buildEnvelope(tenantB, "identity.farm_created.v1", "farm", {
      name: "Pasto do Cedro",
    });
    await new EventStatsProjector().projectWithPool(db.workerPool, envelope);
    const after = await db.adminPool.query(
      `SELECT event_count, calculated_at, last_event_at FROM projection_event_stats
        WHERE tenant_id = $1 AND aggregate_type = 'farm'`,
      [tenantB],
    );
    expect(Number(after.rows[0].event_count)).toBe(
      Number(before.rows[0].event_count) + 1,
    );
    expect(after.rows[0].calculated_at.getTime()).toBeGreaterThanOrEqual(
      before.rows[0].calculated_at.getTime(),
    );
    expect(after.rows[0].last_event_at.toISOString()).toBe(envelope.occurredAt);
  });

  it("jk_app under tenant B cannot read tenant A stats (RLS, JK-SEC-004/005)", async () => {
    const fromB = await withTenantTransaction(db.appPool, contextFor(tenantB), (client) =>
      client.query(`SELECT tenant_id, aggregate_type, event_count, calculated_at
                      FROM projection_event_stats`),
    );
    expect(fromB.rows.length).toBeGreaterThan(0);
    expect(fromB.rows.every((r) => r.tenant_id === tenantB)).toBe(true);

    const fromA = await withTenantTransaction(db.appPool, contextFor(tenantA), (client) =>
      client.query(`SELECT tenant_id FROM projection_event_stats`),
    );
    expect(fromA.rows.every((r) => r.tenant_id === tenantA)).toBe(true);

    // Without tenant context the app role sees nothing (fail closed).
    const bare = await db.appPool.query(`SELECT * FROM projection_event_stats`);
    expect(bare.rows).toHaveLength(0);
  });

  it("jk_app is read-only on the projection and blind to the dedupe store", async () => {
    await expect(
      withTenantTransaction(db.appPool, contextFor(tenantB), (client) =>
        client.query(
          `INSERT INTO projection_event_stats (tenant_id, aggregate_type, event_count)
           VALUES ($1, 'forjado', 99)`,
          [tenantB],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(db.appPool.query(`SELECT * FROM processed_message`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe.skipIf(available)("projector suite (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
