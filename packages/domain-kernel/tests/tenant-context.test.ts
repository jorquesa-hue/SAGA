import { describe, expect, it } from "vitest";
import { assertSameTenant, createTenantContext } from "../src/tenant-context.js";
import { TenantIsolationError, ValidationError } from "../src/errors.js";
import { newUuid } from "../src/ids.js";

describe("TenantContext", () => {
  const valid = {
    tenantId: newUuid(),
    actor: { type: "user" as const, id: newUuid() },
    correlationId: newUuid(),
  };

  it("creates a frozen context", () => {
    const ctx = createTenantContext(valid);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(ctx.tenantId).toBe(valid.tenantId);
  });

  it("rejects non-UUID tenant, farm, and correlation ids", () => {
    expect(() => createTenantContext({ ...valid, tenantId: "t1" })).toThrow(
      ValidationError,
    );
    expect(() => createTenantContext({ ...valid, farmId: "f1" })).toThrow(
      ValidationError,
    );
    expect(() =>
      createTenantContext({ ...valid, correlationId: "nope" }),
    ).toThrow(ValidationError);
  });

  it("rejects empty actor ids", () => {
    expect(() =>
      createTenantContext({ ...valid, actor: { type: "user", id: " " } }),
    ).toThrow(ValidationError);
  });

  it("assertSameTenant blocks cross-tenant access (JK-SEC-004)", () => {
    const ctx = createTenantContext(valid);
    expect(() => assertSameTenant(ctx, newUuid())).toThrow(TenantIsolationError);
    expect(() => assertSameTenant(ctx, ctx.tenantId)).not.toThrow();
  });
});
