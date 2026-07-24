import { ValidationError, type Uuid } from "@jk/domain-kernel";
import { z } from "zod";

/**
 * Herd Operations domain types and validated input (§10, §11, §19).
 */

export type SessionPurpose =
  "weighing" | "vaccination" | "pregnancy_check" | "treatment" | "handling" | "other";
export type SessionStatus = "open" | "closed";
export type ResolutionStatus =
  | "accepted"
  | "duplicate"
  | "pending_resolution"
  | "rejected_validation"
  | "retryable_error";

export interface HandlingSession {
  id: Uuid;
  tenantId: Uuid;
  farmId: Uuid;
  purpose: SessionPurpose;
  status: SessionStatus;
  deviceId: string | null;
  operatorId: Uuid | null;
  expectedCount: number | null;
  startedAt: Date;
  closedAt: Date | null;
  summary: SessionSummary | null;
}

export interface SessionSummary {
  expected: number | null;
  processed: number;
  accepted: number;
  flagged: number;
  duplicate: number;
  pendingResolution: number;
  rejected: number;
}

export interface ObservationResult {
  observationId: string;
  serverObservationId: string | null;
  status: ResolutionStatus;
  animalId: Uuid | null;
  eventId: string | null;
  qualityFlags: string[];
  reason?: string;
}

export interface WeightPoint {
  occurredAt: Date;
  weightKg: number;
  eligibleForAnalytics: boolean;
  qualityFlags: string[];
  eventId: string;
}

export interface AdgResult {
  animalId: Uuid;
  firstWeightKg: number;
  lastWeightKg: number;
  firstAt: Date;
  lastAt: Date;
  elapsedDays: number;
  adgKgPerDay: number;
  eligiblePoints: number;
  excludedPoints: number;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const idempotencyKeySchema = z.string().min(1).max(200);

export const startSessionInputSchema = z
  .object({
    farmId: z.string().uuid(),
    purpose: z
      .enum([
        "weighing",
        "vaccination",
        "pregnancy_check",
        "treatment",
        "handling",
        "other",
      ])
      .default("weighing"),
    deviceId: z.string().max(200).optional(),
    expectedCount: z.number().int().nonnegative().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type StartSessionInput = z.infer<typeof startSessionInputSchema>;

export const observationInputSchema = z
  .object({
    observationId: z.string().min(1).max(200),
    gatewayId: z.string().min(1).max(200).default("manual"),
    deviceId: z.string().max(200).optional(),
    capturedAt: z.string().datetime({ offset: true }),
    measurementType: z.literal("weight").default("weight"),
    value: z.number(),
    unit: z.enum(["kg", "lb"]),
    rfid: z.string().max(128).optional(),
    handlingSessionId: z.string().uuid().optional(),
    rawPayload: z.record(z.unknown()).optional(),
  })
  .strict();

export type ObservationInput = z.infer<typeof observationInputSchema>;

export const reviewObservationInputSchema = z
  .object({
    serverObservationId: z.string().uuid(),
    action: z.enum(["confirm", "reject", "relink"]),
    animalId: z.string().uuid().optional(),
    reason: z.string().max(500).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type ReviewObservationInput = z.infer<typeof reviewObservationInputSchema>;

export function parseInput<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  what: string,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      `Invalid ${what}`,
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        reason: issue.message,
      })),
    );
  }
  return result.data;
}

/** Weight plausibility thresholds (§11), tenant-configurable in a later slice. */
export interface WeightValidationConfig {
  /** Absolute lower/upper sanity bounds for a bovine live weight (kg). */
  minPlausibleKg: number;
  maxPlausibleKg: number;
  /** Max plausible average daily change vs the previous eligible weight. */
  maxDailyChangeKg: number;
}

export const DEFAULT_WEIGHT_CONFIG: WeightValidationConfig = {
  minPlausibleKg: 10,
  maxPlausibleKg: 1500,
  maxDailyChangeKg: 3.5,
};
