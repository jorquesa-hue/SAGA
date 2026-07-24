import { type TenantContext } from "@jk/domain-kernel";
import { type Role } from "./roles.js";

/**
 * Central authorization policy for the Identity and Tenancy context
 * (JK-PLT-EES-001 §66, JK-IAM-003).
 *
 * Decisions are pure functions of the caller's loaded memberships so they can
 * be unit-tested exhaustively, and every decision carries a human-readable
 * reason for testing and audit. The application service SHALL load the
 * caller's memberships inside the same database transaction that performs the
 * write, and SHALL enforce the decision before writing. UI hiding is never
 * authorization.
 */

export type IdentityAction =
  "read" | "manage_farms" | "invite_users" | "manage_members" | "manage_tenant";

export interface CallerMembership {
  role: Role;
  status: "invited" | "active" | "revoked";
}

export interface AuthorizationResource {
  type: string;
  id?: string;
}

export interface AuthorizationDecision {
  allowed: boolean;
  /** Explicit decision reason — exposed for testing and audit (§66). */
  reason: string;
  action: IdentityAction;
  resource?: AuthorizationResource;
}

/** Role sets required per action. `null` means "any active membership". */
const REQUIRED_ROLES: Record<IdentityAction, readonly Role[] | null> = {
  read: null,
  manage_farms: ["tenant_owner", "farm_manager"],
  invite_users: ["tenant_owner"],
  manage_members: ["tenant_owner"],
  manage_tenant: ["tenant_owner"],
};

export interface AuthorizationInput {
  context: TenantContext;
  action: IdentityAction;
  /** Memberships of the caller in context.tenantId, loaded in-transaction. */
  memberships: readonly CallerMembership[];
  resource?: AuthorizationResource;
}

export class AuthorizationPolicy {
  decide(input: AuthorizationInput): AuthorizationDecision {
    const { action, resource } = input;
    const activeRoles = input.memberships
      .filter((m) => m.status === "active")
      .map((m) => m.role);
    const suffix = resource
      ? ` on ${resource.type}${resource.id ? `/${resource.id}` : ""}`
      : "";

    if (activeRoles.length === 0) {
      return {
        allowed: false,
        action,
        resource,
        reason:
          `denied: actor '${input.context.actor.id}' holds no active membership in tenant ` +
          `'${input.context.tenantId}' (action '${action}'${suffix} requires an active membership)`,
      };
    }

    const required = REQUIRED_ROLES[action];
    if (required === null) {
      return {
        allowed: true,
        action,
        resource,
        reason: `allowed: active membership [${activeRoles.join(", ")}] permits '${action}'${suffix}`,
      };
    }

    const matching = activeRoles.filter((role) => required.includes(role));
    if (matching.length > 0) {
      return {
        allowed: true,
        action,
        resource,
        reason: `allowed: role '${matching[0]}' permits '${action}'${suffix}`,
      };
    }

    return {
      allowed: false,
      action,
      resource,
      reason:
        `denied: action '${action}'${suffix} requires one of [${required.join(", ")}]; ` +
        `caller holds [${activeRoles.join(", ")}]`,
    };
  }
}
