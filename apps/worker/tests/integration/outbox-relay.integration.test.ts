import {
  createEventEnvelope,
  createTenantContext,
  newUuid,
  type DomainEventEnvelope,
} from "@jk/domain-kernel";
import { appendEvent, withSystemTransaction, withTenantTransaction } from "@jk/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OutboxRelay } from "../../src/outbox-relay.js";
import { InMemoryPublisher, type EventPublisher } from "../../src/publisher.js";
import { createTestDatabase, databaseAvailable, type TestDatabase } from "./setup.js";

const available = databaseAvailable();

/** Publisher that fails every publish (simulated broker outage). */
class FailingPublisher implements EventPublisher {
  attempts = 0;
  async publish(): Promise<void> {
    this.attempts += 1;
    throw new Error("simulated NATS outage: connection refused");
  }
}

/** In-memory publisher with per-message latency (holds relay locks longer). */
class SlowInMemoryPublisher extends InMemoryPublisher {
  constructor(private readonly delayMs: number) {
    super();
  }
  override async publish(subject: string, envelope: DomainEventEnvelope): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    await super.publish(subject, envelope);
  }
}

describe.skipIf(!available)("outbox relay (§31.1-§31.2, real PostgreSQL)", () => {
  let db: TestDatabase;
  let tenantA: string;
  let tenantB: string;

  const contextFor = (tenantId: string) =>
    createTenantContext({
      tenantId,
      actor: { type: "user", id: newUuid(), display: "Gerente Fazenda Aurora" },
      correlationId: newUuid(),
    });

  async function appendFarmCreated(tenantId: string, name: string): Promise<DomainEventEnvelope> {
    const context = contextFor(tenantId);
    const aggregateId = newUuid();
    const envelope = createEventEnvelope({
      eventType: "identity.farm_created.v1",
      context,
      aggregateType: "farm",
      aggregateId,
      aggregateVersion: 1,
      source: { channel: "api" },
      idempotencyKey: `farm-create-${aggregateId}`,
      payload: { name, herd: "Brangus" },
    });
    await withTenantTransaction(db.appPool, context, (client) => appendEvent(client, envelope));
    return envelope;
  }

  async function outboxRow(eventId: string): Promise<{
    published_at: Date | null;
    publish_attempts: number;
    last_error: string | null;
  }> {
    const { rows } = await db.adminPool.query(
      `SELECT published_at, publish_attempts, last_error FROM outbox_message WHERE event_id = $1`,
      [eventId],
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  beforeAll(async () => {
    db = await createTestDatabase("jk_relay");
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

  it("publishes each pending message exactly once and marks it published", async () => {
    const e1 = await appendFarmCreated(tenantA, "Sede");
    const e2 = await appendFarmCreated(tenantA, "Retiro do Ipê");
    const e3 = await appendFarmCreated(tenantB, "Invernada Norte");

    const publisher = new InMemoryPublisher();
    const relay = new OutboxRelay({ pool: db.workerPool, publisher });

    const first = await relay.runOnce();
    expect(first).toMatchObject({ polled: 3, published: 3, failed: 0 });
    expect(publisher.eventIds().sort()).toEqual([e1.eventId, e2.eventId, e3.eventId].sort());

    for (const envelope of [e1, e2, e3]) {
      const row = await outboxRow(envelope.eventId);
      expect(row.published_at).not.toBeNull();
      expect(row.publish_attempts).toBe(1);
      expect(row.last_error).toBeNull();
    }

    // Second run finds nothing: no double publish.
    const second = await relay.runOnce();
    expect(second).toMatchObject({ polled: 0, published: 0, failed: 0 });
    expect(publisher.messages).toHaveLength(3);
  });

  it("subjects never expose the raw tenant id (§49)", async () => {
    const { rows } = await db.adminPool.query(`SELECT subject, tenant_id FROM outbox_message`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.subject).toMatch(/^jk\.local\.a1\.identity\.farm\.farm-created\.v1$/);
      expect(row.subject).not.toContain(row.tenant_id);
    }
  });

  it("two concurrent relays never double-publish (FOR UPDATE SKIP LOCKED)", async () => {
    const pending: DomainEventEnvelope[] = [];
    for (let i = 0; i < 6; i += 1) {
      pending.push(await appendFarmCreated(tenantA, `Pasto Concorrente ${i + 1}`));
    }

    const slow = new SlowInMemoryPublisher(40);
    const fast = new InMemoryPublisher();
    const relayA = new OutboxRelay({ pool: db.workerPool, publisher: slow, batchSize: 3 });
    const relayB = new OutboxRelay({ pool: db.createWorkerPool(), publisher: fast, batchSize: 10 });

    const [resultA, resultB] = await Promise.all([
      relayA.runOnce(),
      // Start B while A holds its row locks.
      new Promise((resolve) => setTimeout(resolve, 15)).then(() => relayB.runOnce()),
    ]);

    const combined = [...slow.eventIds(), ...fast.eventIds()];
    const expected = pending.map((e) => e.eventId).sort();
    // Every pending message published exactly once across both relays.
    expect(combined.length).toBe(new Set(combined).size);
    expect(combined.sort()).toEqual(expected);
    expect(resultA.published + resultB.published).toBe(6);
    expect(resultA.failed + resultB.failed).toBe(0);
  });

  it("records last_error on publish failure and retries on the next run", async () => {
    const envelope = await appendFarmCreated(tenantB, "Curral da Serra");

    const failing = new FailingPublisher();
    const failingRelay = new OutboxRelay({ pool: db.workerPool, publisher: failing });
    const failedRun = await failingRelay.runOnce();
    expect(failedRun).toMatchObject({ polled: 1, published: 0, failed: 1 });

    const afterFailure = await outboxRow(envelope.eventId);
    expect(afterFailure.published_at).toBeNull();
    expect(afterFailure.publish_attempts).toBe(1);
    expect(afterFailure.last_error).toContain("simulated NATS outage");

    // Broker recovers: same message is retried and published.
    const recovered = new InMemoryPublisher();
    const retryRelay = new OutboxRelay({ pool: db.workerPool, publisher: recovered });
    const retryRun = await retryRelay.runOnce();
    expect(retryRun).toMatchObject({ polled: 1, published: 1, failed: 0 });

    const afterRetry = await outboxRow(envelope.eventId);
    expect(afterRetry.published_at).not.toBeNull();
    expect(afterRetry.publish_attempts).toBe(2);
    expect(afterRetry.last_error).toBeNull();
    expect(recovered.eventIds()).toEqual([envelope.eventId]);
  });

  it("start/stop runs the loop and shuts down cleanly", async () => {
    const envelope = await appendFarmCreated(tenantA, "Baia das Palmeiras");
    const publisher = new InMemoryPublisher();
    const relay = new OutboxRelay({ pool: db.workerPool, publisher });

    relay.start(25);
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      await relay.stop();
    }

    expect(publisher.eventIds()).toEqual([envelope.eventId]);
    const row = await outboxRow(envelope.eventId);
    expect(row.published_at).not.toBeNull();

    // After stop, nothing runs anymore even if new messages arrive.
    const late = await appendFarmCreated(tenantA, "Pasto Tardio");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(publisher.eventIds()).not.toContain(late.eventId);
  });
});

describe.skipIf(available)("outbox relay suite (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
