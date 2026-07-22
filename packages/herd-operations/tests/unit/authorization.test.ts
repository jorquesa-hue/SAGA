import { createTenantContext, newUuid } from "@jk/domain-kernel";
import { describe, expect, it } from "vitest";
import { decide, decideServiceActor } from "../../src/authorization.js";

describe("herd-operations authorization", () => {
  it("denies without active membership; allows read for any active member", () => {
    expect(decide("record_weight", []).allowed).toBe(false);
    expect(decide("read", [{ role: "finance_user", status: "active" }]).allowed).toBe(true);
  });

  it("allows herd roles to record weights and manage sessions", () => {
    for (const role of ["tenant_owner", "farm_manager", "technician"]) {
      expect(decide("record_weight", [{ role, status: "active" }]).allowed).toBe(true);
      expect(decide("start_session", [{ role, status: "active" }]).allowed).toBe(true);
    }
  });

  it("denies non-herd roles from recording, with a reason", () => {
    const d = decide("record_weight", [{ role: "auditor", status: "active" }]);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/role not permitted/);
  });

  it("allows device/service actors to record weights only", () => {
    const ctx = createTenantContext({
      tenantId: newUuid(),
      actor: { type: "device", id: newUuid() },
      correlationId: newUuid(),
    });
    expect(decideServiceActor(ctx, "record_weight").allowed).toBe(true);
    expect(decideServiceActor(ctx, "start_session").allowed).toBe(false);
    expect(decideServiceActor(ctx, "review_observation").allowed).toBe(false);
  });
});
