import { describe, expect, it } from "vitest";
import { decide } from "../../src/authorization.js";

describe("health-laboratory authorization", () => {
  it("denies without active membership", () => {
    expect(decide("record_treatment", []).allowed).toBe(false);
  });

  it("allows herd/clinical roles to record treatments", () => {
    for (const role of ["tenant_owner", "farm_manager", "technician", "veterinarian"]) {
      expect(decide("record_treatment", [{ role, status: "active" }]).allowed).toBe(true);
    }
  });

  it("restricts sale-clear override to vet or tenant_owner (JK-HLT-005)", () => {
    expect(
      decide("override_restriction", [{ role: "veterinarian", status: "active" }])
        .allowed,
    ).toBe(true);
    expect(
      decide("override_restriction", [{ role: "tenant_owner", status: "active" }])
        .allowed,
    ).toBe(true);
    const denied = decide("override_restriction", [
      { role: "technician", status: "active" },
    ]);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/requires one of/);
  });

  it("allows any active member to read", () => {
    expect(decide("read", [{ role: "finance_user", status: "active" }]).allowed).toBe(
      true,
    );
  });
});
