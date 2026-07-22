import { z } from "zod";
import { type ActorContext, type SourceContext } from "./actor.js";
import { ValidationError } from "./errors.js";
import { newUlid, type Ulid, type Uuid } from "./ids.js";
import { type TenantContext } from "./tenant-context.js";

/**
 * Immutable domain event envelope (JK-PLT-EES-001 §39).
 *
 * Event types are lower-case dot-separated past-tense facts with a version
 * suffix, e.g. "animal.weight_recorded.v1". Envelopes are validated at
 * creation and again at consumption; consumers declare supported versions
 * and fail visibly on unsupported critical events.
 */

export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+\.v[1-9][0-9]*$/;

export const actorSchema = z.object({
  type: z.enum(["user", "device", "service", "agent"]),
  id: z.string().min(1),
  display: z.string().optional(),
});

export const sourceSchema = z.object({
  channel: z.enum(["web", "mobile", "edge", "import", "api", "system"]),
  deviceId: z.string().nullable().optional(),
  appVersion: z.string().nullable().optional(),
});

export const eventEnvelopeSchema = z.object({
  eventId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "eventId must be a ULID"),
  eventType: z.string().regex(EVENT_TYPE_PATTERN, "invalid event type name"),
  schemaVersion: z.number().int().positive(),
  tenantId: z.string().uuid(),
  farmId: z.string().uuid().nullable(),
  aggregateType: z.string().min(1),
  aggregateId: z.string().uuid(),
  aggregateVersion: z.number().int().positive(),
  occurredAt: z.string().datetime({ offset: true }),
  recordedAt: z.string().datetime({ offset: true }),
  actor: actorSchema,
  source: sourceSchema,
  correlationId: z.string().uuid(),
  causationId: z.string().nullable(),
  idempotencyKey: z.string().min(1).max(200),
  payload: z.record(z.unknown()),
  metadata: z
    .object({
      locale: z.string().optional(),
      qualityFlags: z.array(z.string()).default([]),
      supersedesEventId: z.string().nullable().default(null),
    })
    .passthrough(),
});

export type DomainEventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export interface CreateEventInput {
  eventType: string;
  schemaVersion?: number;
  context: TenantContext;
  farmId?: Uuid | null;
  aggregateType: string;
  aggregateId: Uuid;
  aggregateVersion: number;
  occurredAt?: Date;
  source: SourceContext;
  causationId?: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  metadata?: {
    locale?: string;
    qualityFlags?: string[];
    supersedesEventId?: string | null;
  };
}

/**
 * Build and validate a new envelope. The event id is a monotonic ULID; the
 * actor, tenant, and correlation context are taken from the TenantContext so
 * they can never diverge from the executing context.
 */
export function createEventEnvelope(input: CreateEventInput): DomainEventEnvelope {
  const now = new Date();
  const candidate = {
    eventId: newUlid() as Ulid,
    eventType: input.eventType,
    schemaVersion: input.schemaVersion ?? versionFromEventType(input.eventType),
    tenantId: input.context.tenantId,
    farmId: input.farmId ?? input.context.farmId ?? null,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    occurredAt: (input.occurredAt ?? now).toISOString(),
    recordedAt: now.toISOString(),
    actor: input.context.actor as ActorContext,
    source: input.source,
    correlationId: input.context.correlationId,
    causationId: input.causationId ?? null,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload,
    metadata: {
      locale: input.metadata?.locale,
      qualityFlags: input.metadata?.qualityFlags ?? [],
      supersedesEventId: input.metadata?.supersedesEventId ?? null,
    },
  };
  return validateEventEnvelope(candidate);
}

export function validateEventEnvelope(candidate: unknown): DomainEventEnvelope {
  const result = eventEnvelopeSchema.safeParse(candidate);
  if (!result.success) {
    throw new ValidationError(
      "Invalid domain event envelope",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        reason: issue.message,
      })),
    );
  }
  return result.data;
}

/** Extract the numeric version from an event type name ("...v3" -> 3). */
export function versionFromEventType(eventType: string): number {
  const match = /\.v([1-9][0-9]*)$/.exec(eventType);
  if (!match) {
    throw new ValidationError(
      `Event type '${eventType}' does not end with a version suffix (.vN)`,
    );
  }
  return Number(match[1]);
}
