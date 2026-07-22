import { z } from "zod";

/**
 * Canonical tenant-scoped roles (JK-PLT-EES-001 §17). platform_admin is a
 * platform-level attribute handled OUTSIDE tenant membership and is therefore
 * intentionally absent from this list.
 */
export const TENANT_ROLES = [
  "tenant_owner",
  "farm_manager",
  "technician",
  "veterinarian",
  "genetics_specialist",
  "finance_user",
  "auditor",
  "integration_service",
] as const;

export type Role = (typeof TENANT_ROLES)[number];

/** Roles assignable at farm scope (mirror of the farm_membership CHECK). */
export const FARM_ROLES = [
  "farm_manager",
  "technician",
  "veterinarian",
  "genetics_specialist",
  "finance_user",
  "auditor",
] as const;

export type FarmRole = (typeof FARM_ROLES)[number];

export const roleSchema = z.enum(TENANT_ROLES);
export const farmRoleSchema = z.enum(FARM_ROLES);

export function isRole(value: string): value is Role {
  return (TENANT_ROLES as readonly string[]).includes(value);
}
