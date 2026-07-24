import {
  createTenantContext,
  newUuid,
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
import { WebhookService } from "../../src/webhook-service.js";
import {
  ConnectorRegistryService,
  WEBHOOK_ADAPTER,
} from "../../src/connector-registry.js";
import { createDispatchScheduler } from "../../src/dispatch-scheduler.js";
import {
  DeliveryDispatcher,
  type WebhookTransport,
  type WebhookTransportRequest,
  type WebhookTransportResponse,
} from "../../src/delivery-dispatcher.js";
import { EventFamilyNotAllowedError } from "../../src/errors.js";
import { IntegrationForbiddenError } from "../../src/errors.js";
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  signDelivery,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "../../src/signing.js";

const available = databaseAvailable();

/** A service actor (the scheduled relay/dispatcher path). */
function serviceContext(tenantId: Uuid): TenantContext {
  return createTenantContext({
    tenantId,
    actor: { type: "service", id: newUuid(), display: "relay" },
    correlationId: newUuid(),
  });
}

/** Configurable transport that records every request it received. */
class FakeTransport implements WebhookTransport {
  last: WebhookTransportRequest | null = null;
  requests: WebhookTransportRequest[] = [];
  constructor(
    public statusCode: number = 200,
    public throwError = false,
  ) {}
  async deliver(request: WebhookTransportRequest): Promise<WebhookTransportResponse> {
    this.last = request;
    this.requests.push(request);
    if (this.throwError) throw new Error("connection refused");
    return { statusCode: this.statusCode };
  }
  forEvent(eventType: string): WebhookTransportRequest | undefined {
    return this.requests.find((r) => r.headers[EVENT_HEADER] === eventType);
  }
}

describe.skipIf(!available)("Webhooks + connectors (integration)", () => {
  let db: TestDatabase;
  let webhooks: WebhookService;
  let connectors: ConnectorRegistryService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_webhooks");
    identity = makeIdentityService(db);
    webhooks = new WebhookService({ appPool: db.appPool, environment: "test" });
    connectors = new ConnectorRegistryService({
      appPool: db.appPool,
      environment: "test",
    });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Webhooks",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("subscribes to an allowlisted family and returns the secret once (§51)", async () => {
    const sub = await webhooks.subscribe(owner, {
      url: "https://example.com/hook",
      eventFamilies: ["animal", "weight"],
      description: "herd events",
    });
    expect(sub.secret).toMatch(/^whsec_/);
    expect(sub.eventFamilies).toEqual(["animal", "weight"]);

    // Read models never expose the secret.
    const listed = await webhooks.listSubscriptions(owner);
    expect(listed.some((s) => s.id === sub.id)).toBe(true);
    expect(listed[0]).not.toHaveProperty("secret");
  });

  it("rejects a subscription to a non-allowlisted family (§51)", async () => {
    await expect(
      webhooks.subscribe(owner, {
        url: "https://example.com/h",
        eventFamilies: ["identity"],
      }),
    ).rejects.toBeInstanceOf(EventFamilyNotAllowedError);
  });

  it("denies subscription management to a non-management role (technician)", async () => {
    const invite = await identity.inviteUser(owner, {
      email: "tec@example.com",
      displayName: "Tec",
      role: "technician",
    });
    await identity.activateMembership(owner, {
      userId: invite.userId,
      role: "technician",
    });
    const tech = makeTenantContext(tenantId, invite.userId);
    await expect(
      webhooks.subscribe(tech, {
        url: "https://example.com/h",
        eventFamilies: ["animal"],
      }),
    ).rejects.toBeInstanceOf(IntegrationForbiddenError);
  });

  it("rotates the secret with an overlap window (§51)", async () => {
    const sub = await webhooks.subscribe(owner, {
      url: "https://example.com/rot",
      eventFamilies: ["finance"],
    });
    const rotated = await webhooks.rotateSecret(owner, sub.id);
    expect(rotated.secret).not.toBe(sub.secret);

    // A message signed with the PREVIOUS secret still verifies (overlap).
    const body = JSON.stringify({ ok: true });
    const ts = 1_700_000_000;
    const deliveryId = newUuid();
    const oldSig = signDelivery({
      secret: sub.secret,
      deliveryId,
      eventType: "finance.sale_recorded.v1",
      body,
      timestampSeconds: ts,
    }).signature;
    const check = verifySignature({
      secret: rotated.secret,
      secretPrevious: sub.secret,
      deliveryId,
      body,
      timestampSeconds: ts,
      signature: oldSig,
    });
    expect(check.valid).toBe(true);
    expect(check.matched).toBe("previous");
  });

  it("rejects a replayed (stale) signature outside the window (§51)", async () => {
    const body = JSON.stringify({ a: 1 });
    const deliveryId = newUuid();
    const signed = signDelivery({
      secret: "whsec_test",
      deliveryId,
      eventType: "animal.animal_registered.v1",
      body,
      timestampSeconds: 1_000,
    });
    const check = verifySignature({
      secret: "whsec_test",
      deliveryId,
      body,
      timestampSeconds: 1_000,
      signature: signed.signature,
      nowSeconds: 1_000 + 4_000, // far outside the 300s window
    });
    expect(check.valid).toBe(false);
    expect(check.reason).toBe("timestamp_outside_replay_window");
  });

  it("fans an event out only to subscriptions of the matching family", async () => {
    const animalSub = await webhooks.subscribe(owner, {
      url: "https://example.com/a",
      eventFamilies: ["animal"],
    });
    await webhooks.subscribe(owner, {
      url: "https://example.com/f",
      eventFamilies: ["finance"],
    });

    const enqueued = await webhooks.enqueueForEvent(serviceContext(tenantId), {
      eventId: newUuid(),
      eventType: "animal.animal_registered.v1",
      payload: {
        animalId: newUuid(),
        registrationCode: "BR-001",
        secretNote: "should be dropped",
      },
    });
    expect(enqueued).toBeGreaterThanOrEqual(1);

    const deliveries = await webhooks.listDeliveries(owner, {
      subscriptionId: animalSub.id,
    });
    expect(deliveries.length).toBe(1);
    expect(deliveries[0]!.eventFamily).toBe("animal");
  });

  it("does not enqueue for a sensitive (non-allowlisted) event family", async () => {
    const enqueued = await webhooks.enqueueForEvent(serviceContext(tenantId), {
      eventId: newUuid(),
      eventType: "identity.tenant_created.v1",
      payload: { tenantId },
    });
    expect(enqueued).toBe(0);
  });

  it("delivers on a 2xx ack with a verifiable signature and minimized body", async () => {
    const sub = await webhooks.subscribe(owner, {
      url: "https://example.com/ok",
      eventFamilies: ["genetics"],
    });
    const eventId = newUuid();
    await webhooks.enqueueForEvent(serviceContext(tenantId), {
      eventId,
      eventType: "genetics.index_scored.v1",
      payload: { animalId: newUuid(), score: 112, internalActorId: "drop-me" },
    });

    const transport = new FakeTransport(200);
    const dispatcher = new DeliveryDispatcher({ appPool: db.appPool, transport });
    const result = await dispatcher.dispatchDue(serviceContext(tenantId), {
      nowMs: 2_100_000_000_000,
    });
    expect(result.delivered).toBeGreaterThanOrEqual(1);

    // The receiver can verify the signature with the subscription secret.
    const req = transport.forEvent("genetics.index_scored.v1")!;
    const check = verifySignature({
      secret: sub.secret,
      deliveryId: req.headers[DELIVERY_HEADER]!,
      body: req.body,
      timestampSeconds: Number(req.headers[TIMESTAMP_HEADER]),
      signature: req.headers[SIGNATURE_HEADER]!,
    });
    expect(check.valid).toBe(true);
    // Sensitive field was minimized away.
    expect(req.body).not.toContain("internalActorId");

    const delivered = await webhooks.listDeliveries(owner, { subscriptionId: sub.id });
    expect(delivered[0]!.status).toBe("delivered");
  });

  it("retries with backoff and dead-letters after max attempts, then replays (§51)", async () => {
    const sub = await webhooks.subscribe(owner, {
      url: "https://example.com/fail",
      eventFamilies: ["pasture"],
    });
    const eventId = newUuid();
    await webhooks.enqueueForEvent(serviceContext(tenantId), {
      eventId,
      eventType: "pasture.assessment_recorded.v1",
      payload: { paddockId: newUuid(), coverKgDmHa: 2400 },
    });

    const transport = new FakeTransport(500);
    const dispatcher = new DeliveryDispatcher({ appPool: db.appPool, transport });

    // Advance the clock generously each pass so the delivery is always due.
    let clock = 2_100_000_000_000;
    let status = "pending";
    for (let i = 0; i < 8 && status !== "dead_letter"; i++) {
      await dispatcher.dispatchDue(serviceContext(tenantId), { nowMs: clock });
      clock += 24 * 3600 * 1000;
      const rows = await webhooks.listDeliveries(owner, { subscriptionId: sub.id });
      status = rows[0]!.status;
    }
    expect(status).toBe("dead_letter");

    const attempts = await db.adminPool.query(
      `SELECT count(*)::int AS n FROM webhook_delivery_attempt
        WHERE delivery_id = (SELECT id FROM webhook_delivery WHERE event_id = $1 AND subscription_id = $2)`,
      [eventId, sub.id],
    );
    expect(attempts.rows[0].n).toBeGreaterThanOrEqual(6);

    // Manual replay returns the delivery to pending.
    const rows = await webhooks.listDeliveries(owner, { subscriptionId: sub.id });
    const replayed = await webhooks.replayDelivery(owner, rows[0]!.id);
    expect(replayed.status).toBe("pending");
    expect(replayed.attempts).toBe(0);

    // And a subsequent success delivers it.
    const okTransport = new FakeTransport(200);
    const okDispatcher = new DeliveryDispatcher({
      appPool: db.appPool,
      transport: okTransport,
    });
    await okDispatcher.dispatchDue(serviceContext(tenantId), { nowMs: clock });
    const after = await webhooks.listDeliveries(owner, { subscriptionId: sub.id });
    expect(after[0]!.status).toBe("delivered");
  });

  it("dispatches per tenant via the scheduler with a pluggable tenant source", async () => {
    const sub = await webhooks.subscribe(owner, {
      url: "https://example.com/sched",
      eventFamilies: ["asset"],
    });
    await webhooks.enqueueForEvent(serviceContext(tenantId), {
      eventId: newUuid(),
      eventType: "asset.maintenance_due.v1",
      payload: { assetId: newUuid(), status: "due" },
    });
    const transport = new FakeTransport(200);
    const scheduler = createDispatchScheduler({
      appPool: db.appPool,
      transport,
      listTenantIds: async () => [tenantId],
      clock: () => 2_200_000_000_000,
    });
    const tick = await scheduler.runOnce();
    expect(tick.tenants).toBe(1);
    expect(tick.totals.delivered).toBeGreaterThanOrEqual(1);
    const rows = await webhooks.listDeliveries(owner, { subscriptionId: sub.id });
    expect(rows[0]!.status).toBe("delivered");
  });

  it("registers a connector behind the §33 contract and lists it", async () => {
    const reg = await connectors.registerConnector(owner, {
      connectorType: "accounting_export",
      name: "Contabilidade",
      config: { format: "csv" },
    });
    expect(reg.status).toBe("active");
    const listed = await connectors.listConnectors(owner);
    expect(listed.some((c) => c.id === reg.id)).toBe(true);
    expect(WEBHOOK_ADAPTER.contract.failureMode).toBe("dead_letter");
  });

  it("does not leak subscriptions or deliveries across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    await expect(webhooks.listSubscriptions(other.ownerContext)).resolves.toEqual([]);
    await expect(webhooks.listDeliveries(other.ownerContext)).resolves.toEqual([]);
  });
});

describe.skipIf(available)("Webhooks (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
