import { describe, expect, it } from "vitest";
import { decide } from "../../src/authorization.js";
import { addDaysIsoDate, BOVINE_GESTATION_DAYS } from "../../src/domain.js";

describe("reproduction authorization", () => {
  it("denies without active membership; allows read for members", () => {
    expect(decide("record_reproduction", []).allowed).toBe(false);
    expect(decide("read", [{ role: "finance_user", status: "active" }]).allowed).toBe(true);
  });

  it("allows herd/clinical roles to record", () => {
    for (const role of ["tenant_owner", "farm_manager", "technician", "veterinarian"]) {
      expect(decide("record_reproduction", [{ role, status: "active" }]).allowed).toBe(true);
    }
  });

  it("denies genetics_specialist-only from recording reproduction with a reason", () => {
    const d = decide("record_reproduction", [{ role: "genetics_specialist", status: "active" }]);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/requires one of/);
  });
});

describe("gestation math", () => {
  it("adds the bovine gestation length to a service date", () => {
    expect(addDaysIsoDate("2026-01-01T00:00:00.000Z", BOVINE_GESTATION_DAYS)).toBe("2026-10-11");
  });
});
