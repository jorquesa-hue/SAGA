import { createTenantContext, newUuid } from "@jk/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  AuthorizationPolicy,
  type CallerMembership,
  type IdentityAction,
} from "../../src/authorization.js";
import { TENANT_ROLES, type Role } from "../../src/roles.js";

/**
 * §66: authorization decisions are pure, exhaustively testable, and every
 * decision exposes a reason. UI hiding is never authorization.
 */

const policy = new AuthorizationPolicy();
const context = createTenantContext({
  tenantId: newUuid(),
  actor: { type: "user", id: newUuid(), display: "Ana Souza" },
  correlationId: newUuid(),
});

const active = (role: Role): CallerMembership => ({ role, status: "active" });

const decide = (action: IdentityAction, memberships: CallerMembership[]) =>
  policy.decide({ context, action, memberships });

describe("AuthorizationPolicy role matrix", () => {
  it("manage_farms is allowed for tenant_owner and farm_manager only", () => {
    const allowedRoles: Role[] = ["tenant_owner", "farm_manager"];
    for (const role of TENANT_ROLES) {
      const decision = decide("manage_farms", [active(role)]);
      expect(decision.allowed, `role ${role}`).toBe(allowedRoles.includes(role));
    }
  });

  it("invite_users and manage_members require tenant_owner", () => {
    for (const action of ["invite_users", "manage_members"] as const) {
      for (const role of TENANT_ROLES) {
        const decision = decide(action, [active(role)]);
        expect(decision.allowed, `${action} as ${role}`).toBe(role === "tenant_owner");
      }
    }
  });

  it("read is allowed for any active membership", () => {
    for (const role of TENANT_ROLES) {
      expect(decide("read", [active(role)]).allowed, `role ${role}`).toBe(true);
    }
  });

  it("denies every action with no membership at all", () => {
    for (const action of [
      "read",
      "manage_farms",
      "invite_users",
      "manage_members",
    ] as const) {
      const decision = decide(action, []);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/no active membership/);
    }
  });

  it("invited and revoked memberships never authorize", () => {
    for (const status of ["invited", "revoked"] as const) {
      const decision = decide("read", [{ role: "tenant_owner", status }]);
      expect(decision.allowed, `status ${status}`).toBe(false);
    }
  });

  it("a matching role among several is sufficient", () => {
    const decision = decide("manage_farms", [
      active("technician"),
      active("farm_manager"),
    ]);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain("farm_manager");
  });
});

describe("AuthorizationPolicy decision reasons (§66)", () => {
  it("every decision carries a non-empty reason and echoes the action", () => {
    const denied = decide("invite_users", [active("technician")]);
    expect(denied.reason).toContain("invite_users");
    expect(denied.reason).toContain("tenant_owner");
    expect(denied.reason).toContain("technician");
    expect(denied.action).toBe("invite_users");

    const allowed = decide("invite_users", [active("tenant_owner")]);
    expect(allowed.reason).toContain("allowed");
    expect(allowed.reason.length).toBeGreaterThan(0);
  });

  it("includes the resource in the decision when provided", () => {
    const decision = policy.decide({
      context,
      action: "manage_farms",
      memberships: [active("auditor")],
      resource: { type: "farm", id: "f-1" },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("farm/f-1");
    expect(decision.resource).toEqual({ type: "farm", id: "f-1" });
  });
});
