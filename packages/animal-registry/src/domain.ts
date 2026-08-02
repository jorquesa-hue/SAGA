import { ValidationError, type Uuid } from "@jk/domain-kernel";
import { z } from "zod";

/**
 * Animal Registry domain types and validated input (§9, §18). Animal identity
 * is stable and independent of lot, paddock, tag, or lifecycle status
 * (JK-DOM-004); its internal UUID never changes (JK-DOM-002).
 */

export type Sex = "female" | "male" | "unknown";
export type BirthDatePrecision =
  "exact" | "estimated_month" | "estimated_year" | "unknown";
export type LifecycleStatus =
  "planned" | "active" | "quarantined" | "sold" | "deceased" | "missing" | "transferred";
export type IdentifierType = "rfid" | "visual" | "official" | "legacy";
export type SpeciesCode = "BOVINE" | "PORCINE" | "OVINE" | "CAPRINE" | "EQUINE";
export type PhotoStatus = "active" | "removed";

export interface Animal {
  id: Uuid;
  tenantId: Uuid;
  farmId: Uuid;
  visualId: string;
  speciesCode: string;
  breedCode: string;
  sex: Sex;
  birthDate: string | null;
  birthDatePrecision: BirthDatePrecision;
  lifecycleStatus: LifecycleStatus;
  version: number;
  createdAt: Date;
}

export interface AnimalIdentifier {
  id: Uuid;
  tenantId: Uuid;
  animalId: Uuid;
  identifierType: IdentifierType;
  identifierValue: string;
  validFrom: Date;
  validTo: Date | null;
  assignedBy: Uuid | null;
  createdAt: Date;
}

export interface AnimalPhoto {
  id: Uuid;
  tenantId: Uuid;
  animalId: Uuid;
  takenAt: string;
  caption: string | null;
  storageKey: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  status: PhotoStatus;
  removedReason: string | null;
  uploadedBy: Uuid | null;
  createdAt: Date;
}

export interface TimelineEntry {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  recordedAt: Date;
  actorType: string;
  actorId: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const nonEmpty = z.string().trim().min(1).max(80);
const idempotencyKeySchema = z.string().min(1).max(200);
const rfidSchema = z.string().trim().min(1).max(128);

export const sexSchema = z.enum(["female", "male", "unknown"]);
export const precisionSchema = z.enum([
  "exact",
  "estimated_month",
  "estimated_year",
  "unknown",
]);
export const identifierTypeSchema = z.enum(["rfid", "visual", "official", "legacy"]);
export const speciesCodeSchema = z.enum([
  "BOVINE",
  "PORCINE",
  "OVINE",
  "CAPRINE",
  "EQUINE",
]);

/** Content types accepted for animal photo uploads. */
export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const photoContentTypeSchema = z.enum(PHOTO_CONTENT_TYPES);
/** 15 MiB — generous for a phone/camera photo, small enough to bound storage cost. */
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

export const registerAnimalInputSchema = z
  .object({
    farmId: z.string().uuid("farmId must be a UUID"),
    visualId: nonEmpty,
    sex: sexSchema,
    breedCode: nonEmpty.default("BRANGUS"),
    speciesCode: speciesCodeSchema.default("BOVINE"),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "birthDate must be an ISO date (YYYY-MM-DD)")
      .optional(),
    birthDatePrecision: precisionSchema.default("exact"),
    /** Optional initial RFID assigned at registration. */
    rfid: rfidSchema.optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

// z.input (not z.infer/output): callers may omit fields that carry defaults.
export type RegisterAnimalInput = z.input<typeof registerAnimalInputSchema>;

export const assignIdentifierInputSchema = z
  .object({
    animalId: z.string().uuid(),
    identifierType: identifierTypeSchema,
    identifierValue: nonEmpty.max(128),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type AssignIdentifierInput = z.infer<typeof assignIdentifierInputSchema>;

export const replaceIdentifierInputSchema = z
  .object({
    animalId: z.string().uuid(),
    identifierType: identifierTypeSchema,
    newValue: nonEmpty.max(128),
    reason: z.string().trim().max(500).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type ReplaceIdentifierInput = z.infer<typeof replaceIdentifierInputSchema>;

// Metadata only — the API layer receives and stores the raw bytes, computes
// storageKey/checksum/byteSize, then calls this with the result. This
// package never touches image bytes.
export const addPhotoInputSchema = z
  .object({
    animalId: z.string().uuid(),
    takenAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "takenAt must be an ISO date (YYYY-MM-DD)"),
    caption: z.string().trim().max(500).optional(),
    storageKey: z.string().trim().min(1).max(512),
    contentType: photoContentTypeSchema,
    byteSize: z.number().int().positive().max(PHOTO_MAX_BYTES),
    checksumSha256: z
      .string()
      .trim()
      .regex(
        /^[0-9a-f]{64}$/i,
        "checksumSha256 must be a 64-character hex sha256 digest",
      ),
    uploadedBy: z.string().uuid().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type AddPhotoInput = z.infer<typeof addPhotoInputSchema>;

export const removePhotoInputSchema = z
  .object({
    animalId: z.string().uuid(),
    photoId: z.string().uuid(),
    reason: z.string().trim().max(500).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type RemovePhotoInput = z.infer<typeof removePhotoInputSchema>;

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

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

export interface AnimalRow {
  id: string;
  tenant_id: string;
  farm_id: string;
  visual_id: string;
  species_code: string;
  breed_code: string;
  sex: Sex;
  birth_date: string | null;
  birth_date_precision: BirthDatePrecision;
  lifecycle_status: LifecycleStatus;
  version: number;
  created_at: Date;
}

export function mapAnimalRow(row: AnimalRow): Animal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    farmId: row.farm_id,
    visualId: row.visual_id,
    speciesCode: row.species_code,
    breedCode: row.breed_code,
    sex: row.sex,
    birthDate: row.birth_date,
    birthDatePrecision: row.birth_date_precision,
    lifecycleStatus: row.lifecycle_status,
    version: row.version,
    createdAt: row.created_at,
  };
}

export interface IdentifierRow {
  id: string;
  tenant_id: string;
  animal_id: string;
  identifier_type: IdentifierType;
  identifier_value: string;
  valid_from: Date;
  valid_to: Date | null;
  assigned_by: string | null;
  created_at: Date;
}

export function mapIdentifierRow(row: IdentifierRow): AnimalIdentifier {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    animalId: row.animal_id,
    identifierType: row.identifier_type,
    identifierValue: row.identifier_value,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    assignedBy: row.assigned_by,
    createdAt: row.created_at,
  };
}

export interface PhotoRow {
  id: string;
  tenant_id: string;
  animal_id: string;
  taken_at: string;
  caption: string | null;
  storage_key: string;
  content_type: string;
  byte_size: number;
  checksum_sha256: string;
  status: PhotoStatus;
  removed_reason: string | null;
  uploaded_by: string | null;
  created_at: Date;
}

export function mapPhotoRow(row: PhotoRow): AnimalPhoto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    animalId: row.animal_id,
    takenAt: row.taken_at,
    caption: row.caption,
    storageKey: row.storage_key,
    contentType: row.content_type,
    byteSize: row.byte_size,
    checksumSha256: row.checksum_sha256,
    status: row.status,
    removedReason: row.removed_reason,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}
