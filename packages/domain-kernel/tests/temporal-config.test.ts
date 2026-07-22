import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createValidity, isActiveAt, overlaps } from "../src/temporal.js";
import { loadConfig } from "../src/config.js";
import { ValidationError } from "../src/errors.js";

describe("TemporalValidity", () => {
  const jan = new Date("2026-01-01T00:00:00Z");
  const feb = new Date("2026-02-01T00:00:00Z");
  const mar = new Date("2026-03-01T00:00:00Z");

  it("rejects inverted windows", () => {
    expect(() => createValidity(feb, jan)).toThrow(ValidationError);
    expect(() => createValidity(feb, feb)).toThrow(ValidationError);
  });

  it("treats null validTo as open-ended", () => {
    const v = createValidity(jan, null);
    expect(isActiveAt(v, mar)).toBe(true);
    expect(isActiveAt(v, new Date("2025-12-31T23:59:59Z"))).toBe(false);
  });

  it("uses half-open intervals for overlap (temporal exclusion rule)", () => {
    const a = createValidity(jan, feb);
    const b = createValidity(feb, mar); // starts exactly when a ends
    expect(overlaps(a, b)).toBe(false);
    const c = createValidity(jan, mar);
    expect(overlaps(a, c)).toBe(true);
    const open = createValidity(jan, null);
    expect(overlaps(open, b)).toBe(true);
  });
});

describe("loadConfig", () => {
  const schema = z.object({
    DATABASE_URL: z.string().url(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  });

  it("parses valid environment", () => {
    const config = loadConfig(schema, {
      DATABASE_URL: "postgresql://jk:jk@localhost:5432/jk_platform",
    } as NodeJS.ProcessEnv);
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("fails fast with variable names but never raw values", () => {
    expect(() =>
      loadConfig(schema, { DATABASE_URL: "secret-value-not-a-url" } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
    try {
      loadConfig(schema, { DATABASE_URL: "secret-value-not-a-url" } as NodeJS.ProcessEnv);
    } catch (error) {
      expect(String(error)).not.toContain("secret-value-not-a-url");
    }
  });
});
