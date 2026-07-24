import { ValidationError, type Uuid } from "@jk/domain-kernel";
import { z } from "zod";

/**
 * Health and Laboratory domain types and validated input (§13, §23).
 */

export type TreatmentKind = "vaccination" | "treatment";
export type RestrictionType = "withdrawal" | "health_hold" | "quarantine";
export type RestrictionStatus = "active" | "lifted" | "overridden";
export type CaseStatus = "open" | "resolved";

export interface HealthProtocol {
  id: Uuid;
  tenantId: Uuid;
  farmId: Uuid | null;
  name: string;
  speciesCode: string;
  appliesTo: string | null;
  version: number;
  schedule: Record<string, unknown>;
  status: "active" | "retired";
}

export interface Treatment {
  id: Uuid;
  tenantId: Uuid;
  animalId: Uuid;
  protocolId: Uuid | null;
  kind: TreatmentKind;
  productName: string;
  medicineBatch: string | null;
  dose: number | null;
  doseUnit: string | null;
  route: string | null;
  administeredBy: Uuid | null;
  administeredAt: Date;
  withdrawalUntil: Date | null;
  notes: string | null;
}

export interface AnimalRestriction {
  id: Uuid;
  tenantId: Uuid;
  animalId: Uuid;
  restrictionType: RestrictionType;
  sourceTreatmentId: Uuid | null;
  reason: string | null;
  validFrom: Date;
  validTo: Date | null;
  status: RestrictionStatus;
}

export interface SaleClearResult {
  animalId: Uuid;
  clear: boolean;
  activeRestrictions: AnimalRestriction[];
}

export interface HealthCase {
  id: Uuid;
  tenantId: Uuid;
  animalId: Uuid;
  openedAt: Date;
  symptom: string | null;
  diagnosis: string | null;
  status: CaseStatus;
  outcome: string | null;
  closedAt: Date | null;
}

const idempotencyKeySchema = z.string().min(1).max(200);
const nonEmpty = z.string().trim().min(1).max(200);

export const defineProtocolInputSchema = z
  .object({
    name: nonEmpty,
    farmId: z.string().uuid().optional(),
    speciesCode: nonEmpty.default("BOVINE"),
    appliesTo: z.string().max(200).optional(),
    version: z.number().int().positive().default(1),
    schedule: z.record(z.unknown()).default({}),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();
export type DefineProtocolInput = z.input<typeof defineProtocolInputSchema>;

export const recordTreatmentInputSchema = z
  .object({
    animalId: z.string().uuid(),
    kind: z.enum(["vaccination", "treatment"]).default("treatment"),
    productName: nonEmpty,
    medicineBatch: z.string().max(200).optional(),
    dose: z.number().positive().optional(),
    doseUnit: z.string().max(40).optional(),
    route: z.string().max(60).optional(),
    protocolId: z.string().uuid().optional(),
    administeredAt: z.string().datetime({ offset: true }),
    /** Withdrawal period in days; > 0 generates a restriction (JK-DOM-011). */
    withdrawalDays: z.number().nonnegative().optional(),
    notes: z.string().max(1000).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();
export type RecordTreatmentInput = z.input<typeof recordTreatmentInputSchema>;

export const batchTreatmentInputSchema = recordTreatmentInputSchema
  .omit({ animalId: true })
  .extend({ animalIds: z.array(z.string().uuid()).min(1).max(2000) });
export type BatchTreatmentInput = z.input<typeof batchTreatmentInputSchema>;

export const overrideRestrictionInputSchema = z
  .object({
    restrictionId: z.string().uuid(),
    reason: nonEmpty.max(500),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();
export type OverrideRestrictionInput = z.input<typeof overrideRestrictionInputSchema>;

export const openCaseInputSchema = z
  .object({
    animalId: z.string().uuid(),
    symptom: z.string().max(1000).optional(),
    diagnosis: z.string().max(1000).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();
export type OpenCaseInput = z.input<typeof openCaseInputSchema>;

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
