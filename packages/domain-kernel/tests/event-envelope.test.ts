import { describe, expect, it } from "vitest";
import {
  createEventEnvelope,
  validateEventEnvelope,
  versionFromEventType,
  EVENT_TYPE_PATTERN,
} from "../src/event-envelope.js";
import { createTenantContext } from "../src/tenant-context.js";
import { ValidationError } from "../src/errors.js";
import { newUuid } from "../src/ids.js";

const context = createTenantContext({
  tenantId: newUuid(),
  actor: { type: "user", id: newUuid(), display: "Tech A" },
  correlationId: newUuid(),
});

function baseInput() {
  return {
    eventType: "animal.weight_recorded.v1",
    context,
    aggregateType: "animal",
    aggregateId: newUuid(),
    aggregateVersion: 1,
    source: { channel: "api" as const },
    idempotencyKey: "test-idempotency-key-0001",
    payload: { weightKilograms: 312.5, observationId: "obs-1" },
  };
}

describe("event type naming (§39)", () => {
  it("accepts dot-separated past-tense names with version", () => {
    for (const name of [
      "animal.weight_recorded.v1",
      "reproduction.pregnancy_checked.v2",
      "inventory.stock_movement_recorded.v10",
      "identity.tenant_created.v1",
    ]) {
      expect(name).toMatch(EVENT_TYPE_PATTERN);
    }
  });

  it("rejects invalid names", () => {
    for (const name of [
      "WeightRecorded",
      "animal.weight_recorded",
      "animal.weight_recorded.v0",
      "animal..weight.v1",
      "animal.weight_recorded.V1",
    ]) {
      expect(name).not.toMatch(EVENT_TYPE_PATTERN);
    }
  });

  it("extracts schema version from the type name", () => {
    expect(versionFromEventType("animal.weight_recorded.v3")).toBe(3);
    expect(() => versionFromEventType("animal.weight_recorded")).toThrow(
      ValidationError,
    );
  });
});

describe("createEventEnvelope", () => {
  it("builds a valid envelope with ULID id and context-derived identity", () => {
    const envelope = createEventEnvelope(baseInput());
    expect(envelope.eventId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(envelope.tenantId).toBe(context.tenantId);
    expect(envelope.correlationId).toBe(context.correlationId);
    expect(envelope.actor.id).toBe(context.actor.id);
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.metadata.qualityFlags).toEqual([]);
    expect(envelope.metadata.supersedesEventId).toBeNull();
  });

  it("produces monotonically sortable event ids", () => {
    const a = createEventEnvelope(baseInput());
    const b = createEventEnvelope(baseInput());
    expect(b.eventId > a.eventId).toBe(true);
  });

  it("supports superseding correction events (JK-CON-003, §40)", () => {
    const original = createEventEnvelope(baseInput());
    const correction = createEventEnvelope({
      ...baseInput(),
      aggregateVersion: 2,
      metadata: { supersedesEventId: original.eventId },
    });
    expect(correction.metadata.supersedesEventId).toBe(original.eventId);
  });

  it("rejects invalid event types", () => {
    expect(() =>
      createEventEnvelope({ ...baseInput(), eventType: "BadName" }),
    ).toThrow(ValidationError);
  });

  it("rejects non-positive aggregate versions", () => {
    expect(() =>
      createEventEnvelope({ ...baseInput(), aggregateVersion: 0 }),
    ).toThrow(ValidationError);
  });
});

describe("validateEventEnvelope", () => {
  it("round-trips a serialized envelope", () => {
    const envelope = createEventEnvelope(baseInput());
    const parsed = validateEventEnvelope(JSON.parse(JSON.stringify(envelope)));
    expect(parsed.eventId).toBe(envelope.eventId);
  });

  it("reports field-level errors for tampered envelopes", () => {
    const envelope = createEventEnvelope(baseInput());
    const tampered = { ...envelope, tenantId: "not-a-uuid" };
    try {
      validateEventEnvelope(tampered);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors[0]?.field).toBe("tenantId");
    }
  });
});
