/**
 * Candidate-roster analysis: how confusable the animals in this corral
 * actually are with each other.
 *
 * The closed-set advantage is usually quoted from a uniform-ID assumption, and
 * that assumption is wrong in a way that matters enormously. Ranches tag a lot
 * in one contiguous run — 12000, 12001, ... 12499 — so a single-digit misread
 * of one animal's tag very often lands on ANOTHER REAL ANIMAL IN THE SAME LOT.
 *
 * Under uniform IDs a 500-animal session has ~0.006 confusable rivals per tag.
 * Under a contiguous block it is ~2.9 — a ~500x loss of the candidate-set
 * advantage, and the single most important empirical fact in this design.
 *
 * So the roster's density is measured per session rather than assumed, and the
 * decision thresholds adapt to it.
 */

/**
 * Digit pairs an OCR model actually confuses, by visual similarity. Tier A are
 * the frequent, high-cost confusions; these dominate the error budget.
 */
export const TIER_A_CONFUSIONS: ReadonlyArray<readonly [string, string]> = [
  ["0", "8"],
  ["1", "7"],
  ["3", "8"],
  ["5", "6"],
  ["6", "8"],
  ["2", "7"],
];

/** Build a lookup of digit -> visually confusable digits. */
export function confusionMap(
  pairs: ReadonlyArray<readonly [string, string]> = TIER_A_CONFUSIONS,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    map.set(a, [...(map.get(a) ?? []), b]);
    map.set(b, [...(map.get(b) ?? []), a]);
  }
  return map;
}

/** How separable one identifier is from the rest of the roster. */
export interface RosterDensity {
  /** Tier-A confusable rivals: single high-confusion-digit edits that exist. */
  tierARivals: number;
  /** Any single-digit edits that land on another real animal in the roster. */
  anySingleDigitRivals: number;
  /**
   * Probability that a random single-digit corruption hits a real animal.
   * ~0 for well-spread IDs, ~0.5 for a contiguous tag block.
   */
  localDensity: number;
}

/**
 * Measure how many roster members sit one digit away from `identifier`.
 *
 * O(L * 10) hash lookups per identifier — free at corral scale.
 */
export function measureRosterDensity(
  identifier: string,
  roster: ReadonlySet<string>,
  confusions: Map<string, string[]> = confusionMap(),
): RosterDensity {
  let tierA = 0;
  let any = 0;
  const digits = "0123456789";

  for (let i = 0; i < identifier.length; i++) {
    const original = identifier[i]!;
    for (const replacement of digits) {
      if (replacement === original) continue;
      const variant =
        identifier.slice(0, i) + replacement + identifier.slice(i + 1);
      if (!roster.has(variant)) continue;
      any++;
      if ((confusions.get(original) ?? []).includes(replacement)) tierA++;
    }
  }

  const positions = identifier.length * 9;
  return {
    tierARivals: tierA,
    anySingleDigitRivals: any,
    localDensity: positions > 0 ? any / positions : 0,
  };
}

/** Roster-wide separability summary, used to adapt decision thresholds. */
export interface RosterAudit {
  size: number;
  meanTierARivals: number;
  maxTierARivals: number;
  /** Identifiers with at least one Tier-A rival; these cannot be auto-accepted cheaply. */
  ambiguous: string[];
  /** True when IDs look like a contiguous issue block. */
  looksContiguous: boolean;
}

/**
 * Audit an entire candidate roster for separability. The `ambiguous` list is
 * what blocks cheap auto-acceptance: for those animals the tag alone is not
 * enough and a second channel (weight, RFID, operator) must carry the decision.
 */
export function auditRoster(
  roster: readonly string[],
  confusions: Map<string, string[]> = confusionMap(),
): RosterAudit {
  const set = new Set(roster);
  let total = 0;
  let max = 0;
  const ambiguous: string[] = [];

  for (const id of roster) {
    const density = measureRosterDensity(id, set, confusions);
    total += density.tierARivals;
    max = Math.max(max, density.tierARivals);
    if (density.tierARivals > 0) ambiguous.push(id);
  }

  const mean = roster.length > 0 ? total / roster.length : 0;
  return {
    size: roster.length,
    meanTierARivals: mean,
    maxTierARivals: max,
    ambiguous,
    // A contiguous block shows up as a high proportion of members having
    // neighbours one digit away.
    looksContiguous: roster.length >= 10 && ambiguous.length / roster.length > 0.5,
  };
}

/**
 * Mod-11 check digit, appended to newly issued visual IDs.
 *
 * This is the cheapest fix available for the contiguity problem: a check digit
 * makes every single-digit misread provably invalid, collapsing the confusable
 * rival count to zero regardless of how the ranch numbers its tags. It only
 * helps tags issued from now on, which is exactly why it is worth adopting
 * early.
 *
 * Returns "X" for the remainder-10 case so every input has a valid digit.
 */
export function mod11CheckDigit(base: string): string {
  let sum = 0;
  let weight = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    const digit = base.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) continue;
    sum += digit * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const remainder = (11 - (sum % 11)) % 11;
  return remainder === 10 ? "X" : String(remainder);
}

/** True when `identifier` carries a valid trailing mod-11 check digit. */
export function hasValidCheckDigit(identifier: string): boolean {
  if (identifier.length < 2) return false;
  const base = identifier.slice(0, -1);
  return mod11CheckDigit(base) === identifier.slice(-1);
}
