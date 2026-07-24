import {
  createEventEnvelope,
  createTenantContext,
  newUuid,
  type DomainEventEnvelope,
} from "@jk/domain-kernel";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/logger.js";
import {
  InMemoryPublisher,
  LogPublisher,
  NatsJetStreamPublisher,
  sanitizeNatsUrl,
} from "../../src/publisher.js";

function sampleEnvelope(): DomainEventEnvelope {
  const context = createTenantContext({
    tenantId: newUuid(),
    actor: { type: "user", id: newUuid(), display: "Técnica Fazenda Aurora" },
    correlationId: newUuid(),
  });
  return createEventEnvelope({
    eventType: "identity.farm_created.v1",
    context,
    aggregateType: "farm",
    aggregateId: newUuid(),
    aggregateVersion: 1,
    source: { channel: "api" },
    idempotencyKey: newUuid(),
    payload: { name: "Fazenda Boa Esperança", breed: "Brangus" },
  });
}

describe("InMemoryPublisher", () => {
  it("records subject and envelope in order", async () => {
    const publisher = new InMemoryPublisher();
    const envelope = sampleEnvelope();
    await publisher.publish("jk.local.a1.identity.farm.farm-created.v1", envelope);
    expect(publisher.messages).toHaveLength(1);
    expect(publisher.messages[0]!.subject).toBe(
      "jk.local.a1.identity.farm.farm-created.v1",
    );
    expect(publisher.eventIds()).toEqual([envelope.eventId]);
  });
});

describe("LogPublisher (§77 structured logging)", () => {
  it("emits one JSON line per event without payload or raw tenant id", async () => {
    const lines: string[] = [];
    const logger = createLogger(
      { service: "jk-worker" },
      { write: (l) => lines.push(l) },
    );
    const publisher = new LogPublisher(logger);
    const envelope = sampleEnvelope();

    await publisher.publish("jk.local.a1.identity.farm.farm-created.v1", envelope);

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.msg).toBe("event_published");
    expect(parsed.eventId).toBe(envelope.eventId);
    expect(parsed.correlationId).toBe(envelope.correlationId);
    // No secrets, payload, or raw tenant ids in logs (§49/§77).
    expect(lines[0]).not.toContain(envelope.tenantId);
    expect(lines[0]).not.toContain("Boa Esperança");
  });
});

describe("NatsJetStreamPublisher", () => {
  it("wraps connection failures with a clear, credential-free error", async () => {
    const publisher = new NatsJetStreamPublisher(
      "nats://user:hunter2@127.0.0.1:1",
      1_000,
    );
    await expect(
      publisher.publish("jk.local.a1.identity.farm.farm-created.v1", sampleEnvelope()),
    ).rejects.toThrow(/Unable to connect to NATS at nats:\/\/127\.0\.0\.1:1/);
    await expect(
      publisher.publish("jk.local.a1.identity.farm.farm-created.v1", sampleEnvelope()),
    ).rejects.not.toThrow(/hunter2/);
    await publisher.close();
  }, 15_000);

  it("sanitizes credentials out of NATS urls", () => {
    expect(sanitizeNatsUrl("nats://user:secret@nats.example:4222")).not.toContain(
      "secret",
    );
    expect(sanitizeNatsUrl("not a url")).toBe("<invalid nats url>");
  });
});

describe("logger", () => {
  it("honours level threshold and child bindings", () => {
    const lines: string[] = [];
    const logger = createLogger(
      { service: "jk-worker" },
      { level: "info", write: (l) => lines.push(l) },
    );
    logger.debug("hidden");
    logger.child({ component: "relay" }).info("visible", { n: 1 });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.component).toBe("relay");
    expect(parsed.n).toBe(1);
    expect(parsed.level).toBe("info");
  });
});
