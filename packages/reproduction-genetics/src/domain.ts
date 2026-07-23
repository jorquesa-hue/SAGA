import { ValidationError, type Uuid } from "@jk/domain-kernel";
import { z } from "zod";

/** Reproduction and Genetics domain types and validated input (§12, §21). */

export type ServiceMethod = "ai" | "tai" | "natural";
export type PregnancyResult = "positive" | "negative" | "uncertain" | "loss";
export type CalvingOutcome = "live" | "stillborn" | "aborted";
export type CalvingEase = "unassisted" | "easy_pull" | "hard_pull" | "surgical" | "unknown";
export type SireConfidence = "known" | "probable" | "unknown";

/** Standard bovine gestation length used for expected-calving estimates. */
export const BOVINE_GESTATION_DAYS = 283;

export type ReproductionState =
  | "open"
  | "served"
  | "awaiting_check"
  | "pregnant"
  | "calved"
  | "loss";

export interface ReproductionService {
  id: Uuid;
  tenantId: Uuid;
  damId: Uuid;
  method: ServiceMethod;
  serviceDate: Date;
  bullId: Uuid | null;
  externalSireRef: string | null;
  semenBatch: string | null;
  technicianId: Uuid | null;
}

export interface PregnancyCheck {
  id: Uuid;
  tenantId: Uuid;
  damId: Uuid;
  serviceId: Uuid | null;
  checkDate: Date;
  method: string | null;
  result: PregnancyResult;
  gestationDaysEstimate: number | null;
  expectedCalvingDate: string | null;
}

export interface Calving {
  id: Uuid;
  tenantId: Uuid;
  damId: Uuid;
  serviceId: Uuid | null;
  calvingDate: Date;
  ease: CalvingEase | null;
  outcome: CalvingOutcome;
  calfId: Uuid | null;
  birthWeightKg: number | null;
  sireConfidence: SireConfidence | null;
}

export interface ReproductionStatus {
  damId: Uuid;
  state: ReproductionState;
  lastServiceDate: Date | null;
  expectedCalvingDate: string | null;
  lastEventAt: Date | null;
}

const idempotencyKeySchema = z.string().min(1).max(200);

export const recordServiceInputSchema = z
  .object({
    damId: z.string().uuid(),
    method: z.enum(["ai", "tai", "natural"]),
    serviceDate: z.string().datetime({ offset: true }),
    bullId: z.string().uuid().optional(),
    externalSireRef: z.string().max(200).optional(),
    semenBatch: z.string().max(200).optional(),
    technicianId: z.string().uuid().optional(),
    notes: z.string().max(1000).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();
export type RecordServiceInput = z.input<typeof recordServiceInputSchema>;

export const pregnancyCheckInputSchema = z
  .object({
    damId: z.string().uuid(),
    serviceId: z.string().uuid().optional(),
    checkDate: z.string().datetime({ offset: true }),
    method: z.string().max(60).optional(),
    result: z.enum(["positive", "negative", "uncertain", "loss"]),
    gestationDaysEstimate: z.number().int().nonnegative().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();
export type PregnancyCheckInput = z.input<typeof pregnancyCheckInputSchema>;

export const recordCalvingInputSchema = z
  .object({
    damId: z.string().uuid(),
    serviceId: z.string().uuid().optional(),
    calvingDate: z.string().datetime({ offset: true }),
    ease: z.enum(["unassisted", "easy_pull", "hard_pull", "surgical", "unknown"]).optional(),
    outcome: z.enum(["live", "stillborn", "aborted"]),
    birthWeightKg: z.number().positive().optional(),
    sireConfidence: z.enum(["known", "probable", "unknown"]).optional(),
    /** When outcome is 'live', optionally register + link a calf. */
    calf: z
      .object({
        farmId: z.string().uuid(),
        visualId: z.string().trim().min(1).max(80),
        sex: z.enum(["female", "male", "unknown"]),
        rfid: z.string().max(128).optional(),
      })
      .optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();
export type RecordCalvingInput = z.input<typeof recordCalvingInputSchema>;

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

/** Add N days to an ISO datetime and return an ISO date (YYYY-MM-DD). */
export function addDaysIsoDate(iso: string, days: number): string {
  const d = new Date(new Date(iso).getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
