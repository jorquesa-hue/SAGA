import { ValidationError } from "./errors.js";

/**
 * Measurement value object (JK-DOM-007): quantities store a numeric value and
 * canonical unit; display conversion never changes the stored measurement.
 * Canonical units are metric (spec: kg, g/day, ha, L). When a source value
 * arrived in another unit it is preserved alongside the canonical value.
 */

export type CanonicalUnit = "kg" | "g" | "g/day" | "ha" | "m2" | "L" | "head" | "count";
export type SourceUnit = CanonicalUnit | "lb" | "arroba" | "acre" | "gal";

interface Conversion {
  canonical: CanonicalUnit;
  factor: number;
}

/** Conversions into canonical units. 1 source unit = factor canonical units. */
const CONVERSIONS: Record<string, Conversion> = {
  kg: { canonical: "kg", factor: 1 },
  g: { canonical: "g", factor: 1 },
  "g/day": { canonical: "g/day", factor: 1 },
  ha: { canonical: "ha", factor: 1 },
  m2: { canonical: "m2", factor: 1 },
  L: { canonical: "L", factor: 1 },
  head: { canonical: "head", factor: 1 },
  count: { canonical: "count", factor: 1 },
  lb: { canonical: "kg", factor: 0.45359237 },
  // Brazilian cattle arroba: 15 kg live weight convention.
  arroba: { canonical: "kg", factor: 15 },
  acre: { canonical: "ha", factor: 0.40468564224 },
  gal: { canonical: "L", factor: 3.785411784 },
};

export class Measurement {
  private constructor(
    /** Canonical numeric value. */
    readonly value: number,
    /** Canonical unit. */
    readonly unit: CanonicalUnit,
    /** Original value exactly as captured, when converted. */
    readonly sourceValue: number,
    /** Original unit exactly as captured. */
    readonly sourceUnit: SourceUnit,
  ) {}

  static of(value: number, unit: SourceUnit): Measurement {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`Measurement value must be finite, got ${value}`);
    }
    const conversion = CONVERSIONS[unit];
    if (!conversion) {
      throw new ValidationError(`Unsupported unit '${unit}'`);
    }
    const canonicalValue =
      conversion.factor === 1 ? value : roundTo(value * conversion.factor, 6);
    return new Measurement(canonicalValue, conversion.canonical, value, unit);
  }

  get wasConverted(): boolean {
    return this.sourceUnit !== this.unit;
  }

  toJSON(): {
    value: number;
    unit: CanonicalUnit;
    sourceValue: number;
    sourceUnit: SourceUnit;
  } {
    return {
      value: this.value,
      unit: this.unit,
      sourceValue: this.sourceValue,
      sourceUnit: this.sourceUnit,
    };
  }
}

function roundTo(value: number, decimals: number): number {
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}
