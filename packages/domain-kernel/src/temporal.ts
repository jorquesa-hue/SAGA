import { ValidationError } from "./errors.js";

/**
 * Temporal validity for relationships (JK-CON-004, §40): memberships,
 * identifier assignments, and occupations carry valid_from / valid_to.
 * A null validTo means "currently active".
 */
export interface TemporalValidity {
  readonly validFrom: Date;
  readonly validTo: Date | null;
}

export function createValidity(validFrom: Date, validTo: Date | null = null): TemporalValidity {
  if (Number.isNaN(validFrom.getTime())) {
    throw new ValidationError("validFrom must be a valid date");
  }
  if (validTo !== null) {
    if (Number.isNaN(validTo.getTime())) {
      throw new ValidationError("validTo must be a valid date or null");
    }
    if (validTo.getTime() <= validFrom.getTime()) {
      throw new ValidationError("validTo must be after validFrom");
    }
  }
  return Object.freeze({ validFrom, validTo });
}

export function isActiveAt(validity: TemporalValidity, at: Date): boolean {
  if (at.getTime() < validity.validFrom.getTime()) return false;
  if (validity.validTo === null) return true;
  return at.getTime() < validity.validTo.getTime();
}

/** Two validity windows overlap when their half-open intervals intersect. */
export function overlaps(a: TemporalValidity, b: TemporalValidity): boolean {
  const aEnd = a.validTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.validTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.validFrom.getTime() < bEnd && b.validFrom.getTime() < aEnd;
}
