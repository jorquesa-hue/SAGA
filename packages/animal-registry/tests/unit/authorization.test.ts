import { describe, expect, it } from "vitest";
import { decide } from "../../src/authorization.js";

describe("animal-registry authorization", () => {
  it("denies everything without an active membership", () => {
    expect(decide("read", []).allowed).toBe(false);
    expect(decide("register_animal", [{ role: "technician", status: "invited" }]).allowed).toBe(
      false,
    );
  });

  it("allows any active member to read", () => {
    expect(decide("read", [{ role: "finance_user", status: "active" }]).allowed).toBe(true);
  });

  it("allows herd roles to register and manage identifiers", () => {
    for (const role of ["tenant_owner", "farm_manager", "technician"]) {
      expect(decide("register_animal", [{ role, status: "active" }]).allowed).toBe(true);
      expect(decide("manage_identifiers", [{ role, status: "active" }]).allowed).toBe(true);
    }
  });

  it("denies non-herd roles from writing, with a reason", () => {
    const decision = decide("register_animal", [{ role: "finance_user", status: "active" }]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/role not permitted/);
  });
});
