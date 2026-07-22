import { describe, expect, it } from "vitest";
import { Money } from "../src/money.js";
import { InvariantViolationError, ValidationError } from "../src/errors.js";

describe("Money", () => {
  it("parses decimal strings into exact minor units", () => {
    expect(Money.fromDecimal("1234.50", "BRL").minorUnits).toBe(123450n);
    expect(Money.fromDecimal("0.01", "BRL").minorUnits).toBe(1n);
    expect(Money.fromDecimal("-10", "BRL").minorUnits).toBe(-1000n);
    expect(Money.fromDecimal("7", "BRL").toDecimal()).toBe("7.00");
  });

  it("rejects malformed amounts and over-precise fractions", () => {
    expect(() => Money.fromDecimal("1,50", "BRL")).toThrow(ValidationError);
    expect(() => Money.fromDecimal("1.505", "BRL")).toThrow(ValidationError);
    expect(() => Money.fromDecimal("abc", "BRL")).toThrow(ValidationError);
    expect(() => Money.fromDecimal("1.50", "REAIS")).toThrow(ValidationError);
  });

  it("adds and subtracts in the same currency only", () => {
    const a = Money.fromDecimal("10.00", "BRL");
    const b = Money.fromDecimal("2.50", "BRL");
    expect(a.add(b).toDecimal()).toBe("12.50");
    expect(a.subtract(b).toDecimal()).toBe("7.50");
    expect(() => a.add(Money.fromDecimal("1.00", "USD"))).toThrow(
      InvariantViolationError,
    );
  });

  it("allocates without losing a single minor unit", () => {
    const total = Money.fromDecimal("100.00", "BRL");
    const parts = total.allocate([1, 1, 1]);
    const sum = parts.reduce((acc, p) => acc.add(p), Money.zero("BRL"));
    expect(sum.equals(total)).toBe(true);
    // Each part is 33.33 or 33.34.
    for (const p of parts) {
      expect(["33.33", "33.34"]).toContain(p.toDecimal());
    }
  });

  it("allocates proportionally", () => {
    const total = Money.fromDecimal("90.00", "BRL");
    const [a, b] = total.allocate([2, 1]);
    expect(a!.toDecimal()).toBe("60.00");
    expect(b!.toDecimal()).toBe("30.00");
  });

  it("allocates negative totals consistently", () => {
    const total = Money.fromDecimal("-10.01", "BRL");
    const parts = total.allocate([1, 1]);
    const sum = parts.reduce((acc, p) => acc.add(p), Money.zero("BRL"));
    expect(sum.equals(total)).toBe(true);
  });

  it("rejects invalid allocation ratios", () => {
    const m = Money.fromDecimal("10.00", "BRL");
    expect(() => m.allocate([])).toThrow(ValidationError);
    expect(() => m.allocate([0, 0])).toThrow(ValidationError);
    expect(() => m.allocate([-1, 2])).toThrow(ValidationError);
  });

  it("serializes as decimal string plus currency", () => {
    expect(Money.fromDecimal("1234.5", "BRL").toJSON()).toEqual({
      amount: "1234.50",
      currency: "BRL",
    });
  });
});
