import { describe, expect, it } from "vitest";
import { Measurement } from "../src/measurement.js";
import { ValidationError } from "../src/errors.js";

describe("Measurement", () => {
  it("keeps canonical metric units as-is", () => {
    const m = Measurement.of(320.5, "kg");
    expect(m.value).toBe(320.5);
    expect(m.unit).toBe("kg");
    expect(m.wasConverted).toBe(false);
  });

  it("converts pounds to kilograms while preserving the source value", () => {
    const m = Measurement.of(100, "lb");
    expect(m.unit).toBe("kg");
    expect(m.value).toBeCloseTo(45.359237, 5);
    expect(m.sourceValue).toBe(100);
    expect(m.sourceUnit).toBe("lb");
    expect(m.wasConverted).toBe(true);
  });

  it("converts arroba (15 kg convention) and acres", () => {
    expect(Measurement.of(20, "arroba").value).toBe(300);
    expect(Measurement.of(1, "acre").value).toBeCloseTo(0.404686, 5);
  });

  it("rejects unknown units and non-finite values", () => {
    expect(() => Measurement.of(1, "stone" as never)).toThrow(ValidationError);
    expect(() => Measurement.of(Number.NaN, "kg")).toThrow(ValidationError);
    expect(() => Measurement.of(Number.POSITIVE_INFINITY, "kg")).toThrow(ValidationError);
  });

  it("serializes source and canonical values (JK-DOM-007)", () => {
    expect(Measurement.of(100, "lb").toJSON()).toEqual({
      value: 45.359237,
      unit: "kg",
      sourceValue: 100,
      sourceUnit: "lb",
    });
  });
});
