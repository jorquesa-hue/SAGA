import { InvariantViolationError, ValidationError } from "./errors.js";

/**
 * Money value object (JK-DOM-008): stores currency, exact amount, and never
 * loses precision. Amounts are held as bigint minor units with a fixed
 * per-currency exponent. Serialization uses decimal strings plus ISO 4217
 * currency codes (§46 REST conventions).
 */

const CURRENCY_EXPONENTS: Record<string, number> = {
  BRL: 2,
  USD: 2,
  EUR: 2,
};

const DEFAULT_EXPONENT = 2;

export class Money {
  private constructor(
    /** Amount in minor units (e.g. centavos). */
    readonly minorUnits: bigint,
    /** ISO 4217 currency code. */
    readonly currency: string,
    readonly exponent: number,
  ) {}

  static fromDecimal(decimal: string, currency: string): Money {
    const cur = currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) {
      throw new ValidationError(`Invalid currency code '${currency}'`);
    }
    const exponent = CURRENCY_EXPONENTS[cur] ?? DEFAULT_EXPONENT;
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
    if (!match) {
      throw new ValidationError(`Invalid decimal amount '${decimal}'`);
    }
    const [, sign, whole, fraction = ""] = match;
    if (fraction.length > exponent) {
      throw new ValidationError(
        `Amount '${decimal}' has more than ${exponent} decimal places for ${cur}`,
      );
    }
    const padded = fraction.padEnd(exponent, "0");
    const minor = BigInt(whole! + padded) * (sign === "-" ? -1n : 1n);
    return new Money(minor, cur, exponent);
  }

  static fromMinorUnits(minorUnits: bigint, currency: string): Money {
    const cur = currency.toUpperCase();
    const exponent = CURRENCY_EXPONENTS[cur] ?? DEFAULT_EXPONENT;
    return new Money(minorUnits, cur, exponent);
  }

  static zero(currency: string): Money {
    return Money.fromMinorUnits(0n, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new InvariantViolationError(
        `Currency mismatch: ${this.currency} vs ${other.currency}`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency, this.exponent);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency, this.exponent);
  }

  negate(): Money {
    return new Money(-this.minorUnits, this.currency, this.exponent);
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  equals(other: Money): boolean {
    return (
      this.currency === other.currency &&
      this.minorUnits === other.minorUnits &&
      this.exponent === other.exponent
    );
  }

  /**
   * Allocate proportionally by integer ratios without losing a single minor
   * unit (largest-remainder method). Used for split cost allocation
   * (JK-FIN-002).
   */
  allocate(ratios: number[]): Money[] {
    if (ratios.length === 0 || ratios.some((r) => r < 0 || !Number.isFinite(r))) {
      throw new ValidationError("Allocation ratios must be non-negative finite numbers");
    }
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      throw new ValidationError("Allocation ratios must sum to a positive value");
    }
    const scaled = ratios.map((r) => BigInt(Math.round(r * 1_000_000)));
    const scaledTotal = scaled.reduce((a, b) => a + b, 0n);
    const shares = scaled.map((s) => (this.minorUnits * s) / scaledTotal);
    let remainder = this.minorUnits - shares.reduce((a, b) => a + b, 0n);
    // Distribute leftover minor units one by one (deterministically, by index).
    const step = remainder < 0n ? -1n : 1n;
    for (let i = 0; remainder !== 0n; i = (i + 1) % shares.length) {
      shares[i] = shares[i]! + step;
      remainder -= step;
    }
    return shares.map((s) => new Money(s, this.currency, this.exponent));
  }

  /** Decimal string, e.g. "1234.50" (always exponent digits). */
  toDecimal(): string {
    const negative = this.minorUnits < 0n;
    const abs = negative ? -this.minorUnits : this.minorUnits;
    const digits = abs.toString().padStart(this.exponent + 1, "0");
    const whole = digits.slice(0, digits.length - this.exponent);
    const fraction = digits.slice(digits.length - this.exponent);
    return `${negative ? "-" : ""}${whole}${this.exponent > 0 ? "." + fraction : ""}`;
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.toDecimal(), currency: this.currency };
  }
}
