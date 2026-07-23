import { ValidationError, type Uuid } from "@jk/domain-kernel";
import { z } from "zod";
import { farmRoleSchema, roleSchema, type FarmRole, type Role } from "./roles.js";

/**
 * Domain types and validated input schemas for the Identity and Tenancy
 * bounded context (JK-IAM-001..006, §7, §17). All external input is validated
 * at the service boundary; invariants (non-empty names, canonical roles,
 * email format, non-negative area) are encoded here.
 */

export type TenantStatus = "active" | "suspended" | "closed";
export type UserAccountStatus = "invited" | "active" | "deactivated";
export type MembershipStatus = "invited" | "active" | "revoked";

export interface Tenant {
  id: Uuid;
  name: string;
  defaultLocale: string;
  defaultCurrency: string;
  status: TenantStatus;
  createdAt: Date;
}

export interface Farm {
  id: Uuid;
  tenantId: Uuid;
  name: string;
  timezone: string;
  areaHa: number | null;
  createdAt: Date;
}

export interface UserAccount {
  id: Uuid;
  oidcSubject: string | null;
  email: string;
  displayName: string;
  status: UserAccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantMembership {
  id: Uuid;
  tenantId: Uuid;
  userId: Uuid;
  role: Role;
  status: MembershipStatus;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
}

export interface FarmMembership {
  id: Uuid;
  tenantId: Uuid;
  farmId: Uuid;
  userId: Uuid;
  role: FarmRole;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
}

/** Membership joined with the user snapshot, as returned by listMembers. */
export interface TenantMember extends TenantMembership {
  email: string;
  displayName: string;
  userStatus: UserAccountStatus;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const nonEmptyName = z.string().trim().min(1, "name must not be empty").max(200);
const emailSchema = z.string().trim().email("invalid email address").max(320);
const idempotencyKeySchema = z.string().min(1).max(200);

export const createTenantInputSchema = z
  .object({
    name: nonEmptyName,
    defaultLocale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "locale must look like 'pt-BR'")
      .optional(),
    defaultCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code")
      .optional(),
    /**
     * Optional initial tenant owner. Tenant onboarding is a platform
     * operation; bootstrapping the first tenant_owner here avoids a tenant
     * nobody can administer.
     */
    owner: z
      .object({
        email: emailSchema,
        displayName: nonEmptyName,
      })
      .optional(),
    correlationId: z.string().uuid().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type CreateTenantInput = z.infer<typeof createTenantInputSchema>;

/**
 * Update a tenant's configurable settings (base locale/currency). At least one
 * field must be present. Tenant settings are mutable configuration (not
 * append-only domain history), but each change still appends an event and an
 * audit record so the change is traceable (§68).
 */
export const updateTenantSettingsInputSchema = z
  .object({
    defaultLocale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "locale must look like 'pt-BR'")
      .optional(),
    defaultCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code")
      .optional(),
    correlationId: z.string().uuid().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict()
  .refine((v) => v.defaultLocale !== undefined || v.defaultCurrency !== undefined, {
    message: "at least one of defaultLocale or defaultCurrency must be provided",
  });

export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsInputSchema>;

export const createFarmInputSchema = z
  .object({
    name: nonEmptyName,
    timezone: z
      .string()
      .regex(
        /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/,
        "timezone must be an IANA zone like 'America/Sao_Paulo'",
      )
      .optional(),
    areaHa: z
      .number()
      .finite()
      .nonnegative("areaHa must be >= 0")
      .optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type CreateFarmInput = z.infer<typeof createFarmInputSchema>;

export const inviteUserInputSchema = z
  .object({
    email: emailSchema,
    displayName: nonEmptyName,
    role: roleSchema,
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type InviteUserInput = z.infer<typeof inviteUserInputSchema>;

export const membershipChangeInputSchema = z
  .object({
    userId: z.string().uuid("userId must be a UUID"),
    role: roleSchema,
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type MembershipChangeInput = z.infer<typeof membershipChangeInputSchema>;

export const farmRoleInputSchema = farmRoleSchema;

/** Validate external input; zod issues become field-level ValidationErrors. */
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
// Row mappers (snake_case pg rows -> domain types)
// ---------------------------------------------------------------------------

export interface TenantRow {
  id: string;
  name: string;
  default_locale: string;
  default_currency: string;
  status: TenantStatus;
  created_at: Date;
}

export function mapTenantRow(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    defaultLocale: row.default_locale,
    defaultCurrency: row.default_currency,
    status: row.status,
    createdAt: row.created_at,
  };
}

export interface FarmRow {
  id: string;
  tenant_id: string;
  name: string;
  timezone: string;
  area_ha: string | null;
  created_at: Date;
}

export function mapFarmRow(row: FarmRow): Farm {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    timezone: row.timezone,
    areaHa: row.area_ha === null ? null : Number(row.area_ha),
    createdAt: row.created_at,
  };
}

export interface TenantMembershipRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: Role;
  status: MembershipStatus;
  valid_from: Date;
  valid_to: Date | null;
  created_at: Date;
}

export function mapMembershipRow(row: TenantMembershipRow): TenantMembership {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    createdAt: row.created_at,
  };
}
