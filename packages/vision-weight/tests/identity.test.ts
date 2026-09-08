import { describe, expect, it } from "vitest";
import {
  ctcScore,
  effectiveFrameCount,
  fuseFrameScores,
  greedyDecode,
  latticeFromLogits,
  logSumExp,
  type CtcLattice,
} from "../src/identity/ctc.js";
import {
  auditRoster,
  hasValidCheckDigit,
  measureRosterDensity,
  mod11CheckDigit,
} from "../src/identity/roster.js";
import {
  DEFAULT_THRESHOLDS,
  predictWeight,
  resolveIdentity,
  type Candidate,
} from "../src/identity/posterior.js";

const DIGITS = "0123456789";
const BLANK = 10;

/**
 * Build a lattice from a symbol-per-timestep script, where "_" is the CTC
 * blank. `confidence` is the probability mass on the intended symbol; the rest
 * is spread evenly, which is what a real recogniser's softmax looks like.
 */
function latticeFor(script: string[], confidence = 0.97): CtcLattice {
  const logits = script.map((symbol) => {
    const row = new Array<number>(11).fill(0);
    const intended = symbol === "_" ? BLANK : DIGITS.indexOf(symbol);
    const other = Math.log((1 - confidence) / 10);
    for (let k = 0; k < 11; k++) row[k] = k === intended ? Math.log(confidence) : other;
    return row;
  });
  // Already log-probabilities; latticeFromLogits re-normalises harmlessly.
  return latticeFromLogits(logits, DIGITS, BLANK);
}

describe("log-space helpers", () => {
  it("computes log-sum-exp without overflow", () => {
    expect(logSumExp([Math.log(0.2), Math.log(0.3), Math.log(0.5)])).toBeCloseTo(0, 12);
    // Large magnitudes must not overflow.
    expect(logSumExp([1000, 1000])).toBeCloseTo(1000 + Math.log(2), 9);
    expect(logSumExp([])).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("CTC closed-set scoring", () => {
  it("scores the string the lattice actually spells far above a near-miss", () => {
    const lattice = latticeFor(["1", "_", "2", "_", "3", "_", "4"]);
    const correct = ctcScore(lattice, "1234");
    const nearMiss = ctcScore(lattice, "1244");

    expect(correct).toBeGreaterThan(nearMiss);
    // A clean read is worth many nats over a single-digit rival — this margin
    // is exactly what the decision threshold consumes.
    expect(correct - nearMiss).toBeGreaterThan(3);
  });

  it("handles repeated digits, which need a blank between them", () => {
    const lattice = latticeFor(["1", "_", "1", "_", "2"]);
    // "112" is spellable on this path; "12" is not the same string.
    expect(ctcScore(lattice, "112")).toBeGreaterThan(ctcScore(lattice, "12"));
    expect(Number.isFinite(ctcScore(lattice, "112"))).toBe(true);
  });

  it("returns -Infinity for symbols outside the alphabet or impossible lengths", () => {
    const lattice = latticeFor(["1", "_", "2"]);
    expect(ctcScore(lattice, "1A2")).toBe(Number.NEGATIVE_INFINITY);
    // Target longer than the lattice has timesteps.
    expect(ctcScore(lattice, "123456")).toBe(Number.NEGATIVE_INFINITY);
  });

  it("is a proper log-probability: never positive", () => {
    const lattice = latticeFor(["7", "_", "0", "_", "4"]);
    for (const candidate of ["704", "714", "700", "104"]) {
      expect(ctcScore(lattice, candidate)).toBeLessThanOrEqual(1e-9);
    }
  });

  it("greedy-decodes only to form the out-of-set hypothesis", () => {
    expect(greedyDecode(latticeFor(["9", "_", "8", "8", "_", "1"]))).toBe("981");
  });
});

describe("frame correlation", () => {
  it("shows thirty correlated frames are worth under three independent reads", () => {
    // This is why summing raw per-frame likelihoods invalidates every
    // threshold downstream: it claims ten times the evidence it has.
    expect(effectiveFrameCount(30, 0.35)).toBeCloseTo(2.69, 2);
    expect(effectiveFrameCount(30, 0)).toBe(30);
    expect(effectiveFrameCount(1, 0.35)).toBe(1);
  });

  it("discounts fused evidence rather than trusting the raw sum", () => {
    const perFrame = [-2, -2, -2, -2, -2];
    expect(fuseFrameScores(perFrame, 0.8)).toBeCloseTo(-8, 9);
    expect(fuseFrameScores(perFrame, 1)).toBeCloseTo(-10, 9);
    // One unreadable frame poisons the pass rather than being silently dropped.
    expect(fuseFrameScores([-2, Number.NEGATIVE_INFINITY])).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });
});

describe("roster density — how ranches actually number tags", () => {
  it("finds almost no confusable rivals when IDs are well spread", () => {
    const roster = new Set(["10428", "23971", "38105", "47562", "59830"]);
    const density = measureRosterDensity("10428", roster);
    expect(density.tierARivals).toBe(0);
    expect(density.anySingleDigitRivals).toBe(0);
  });

  it("finds many rivals in a contiguous tag block — the dominant real-world case", () => {
    // A lot tagged in one run, exactly how it is done in practice.
    const roster = new Set(Array.from({ length: 500 }, (_, i) => String(12000 + i)));
    const density = measureRosterDensity("12345", roster);

    // Every units-digit and tens-digit variant is another real animal here.
    expect(density.anySingleDigitRivals).toBeGreaterThan(15);
    expect(density.tierARivals).toBeGreaterThan(0);
    expect(density.localDensity).toBeGreaterThan(0.3);

    const audit = auditRoster([...roster]);
    expect(audit.looksContiguous).toBe(true);
    // Most of the lot cannot be auto-accepted on the tag alone.
    expect(audit.ambiguous.length / audit.size).toBeGreaterThan(0.5);
  });

  it("collapses rivals to zero once IDs carry a check digit", () => {
    // The cheap structural fix: a mod-11 check digit makes every single-digit
    // misread provably invalid, regardless of how the ranch numbers its tags.
    const withCheck = Array.from({ length: 500 }, (_, i) => {
      const base = String(12000 + i);
      return base + mod11CheckDigit(base);
    });
    const audit = auditRoster(withCheck);
    expect(audit.meanTierARivals).toBe(0);
    expect(audit.ambiguous).toHaveLength(0);
    expect(hasValidCheckDigit(withCheck[10]!)).toBe(true);
    expect(hasValidCheckDigit(withCheck[10]!.slice(0, -1) + "0")).toBe(false);
  });
});

describe("identity resolution", () => {
  const candidates: Candidate[] = [
    {
      animalId: "a-1",
      visualId: "12345",
      tier: "session",
      lastWeightKg: 400,
      daysSinceLastWeight: 30,
      adgKgPerDay: 0.8,
    },
    {
      animalId: "a-2",
      visualId: "12845",
      tier: "session",
      lastWeightKg: 250,
      daysSinceLastWeight: 30,
      adgKgPerDay: 0.7,
    },
    {
      animalId: "a-3",
      visualId: "99999",
      tier: "farm",
      lastWeightKg: 410,
      daysSinceLastWeight: 30,
      adgKgPerDay: 0.8,
    },
  ];

  function tagEvidence(scores: Record<string, number>): Map<string, number> {
    return new Map(Object.entries(scores));
  }

  it("auto-accepts a confident tag read backed by a consistent weight", () => {
    const result = resolveIdentity(candidates, {
      tagLogLikelihoodByAnimalId: tagEvidence({ "a-1": -0.5, "a-2": -12, "a-3": -30 }),
      outOfSetTagLogLikelihood: -25,
      estimatedWeightKg: 424,
      estimatedWeightSigmaKg: 12,
    });

    expect(result.decision).toBe("auto_accept");
    expect(result.best?.animalId).toBe("a-1");
    expect(result.marginNats).toBeGreaterThan(DEFAULT_THRESHOLDS.minMarginNats);
  });

  it("routes an ambiguous single-digit rival to review rather than guessing", () => {
    // The contiguous-block nightmare: two real animals one digit apart, and the
    // recogniser cannot separate them.
    const result = resolveIdentity(candidates, {
      tagLogLikelihoodByAnimalId: tagEvidence({ "a-1": -2.0, "a-2": -2.3, "a-3": -30 }),
      outOfSetTagLogLikelihood: -25,
    });

    expect(result.decision).toBe("review");
    expect(result.flags).toContain("low_identity_margin");
  });

  it("uses the weight as a veto when the tag points at an implausible animal", () => {
    // Tag says a-2 (last weighed 250 kg), but the camera sees 424 kg.
    const result = resolveIdentity(candidates, {
      tagLogLikelihoodByAnimalId: tagEvidence({ "a-1": -14, "a-2": -0.4, "a-3": -30 }),
      outOfSetTagLogLikelihood: -25,
      estimatedWeightKg: 424,
      estimatedWeightSigmaKg: 12,
    });

    expect(result.decision).toBe("review");
    expect(result.flags).toContain("weight_identity_conflict");
  });

  it("treats a resolved RFID as authoritative", () => {
    const result = resolveIdentity(candidates, {
      rfidAnimalId: "a-2",
      estimatedWeightKg: 271,
      estimatedWeightSigmaKg: 12,
    });
    expect(result.decision).toBe("auto_accept");
    expect(result.best?.animalId).toBe("a-2");
    expect(result.flags).toContain("identity_rfid");
  });

  it("flags a chip that disagrees with a confident tag read", () => {
    // A swapped or mis-applied tag: normally invisible, and it silently
    // corrupts the record of two animals at once.
    const result = resolveIdentity(candidates, {
      rfidAnimalId: "a-2",
      tagLogLikelihoodByAnimalId: tagEvidence({ "a-1": -0.3, "a-2": -18 }),
    });
    expect(result.decision).toBe("review");
    expect(result.flags).toContain("tag_chip_mismatch");
  });

  it("recognises an animal that is not in the roster at all", () => {
    const result = resolveIdentity(candidates, {
      tagLogLikelihoodByAnimalId: tagEvidence({ "a-1": -40, "a-2": -41, "a-3": -44 }),
      outOfSetTagLogLikelihood: -0.5,
    });
    expect(result.decision).toBe("no_identity");
    expect(result.flags).toContain("animal_not_in_roster");
    expect(result.outOfSetPosterior).toBeGreaterThan(0.5);
  });

  it("penalises re-weighing an animal already recorded this session", () => {
    const repeated = candidates.map((c) =>
      c.animalId === "a-1" ? { ...c, alreadyAssignedCount: 1 } : c,
    );
    const evidence = {
      tagLogLikelihoodByAnimalId: tagEvidence({ "a-1": -0.5, "a-2": -12, "a-3": -30 }),
      outOfSetTagLogLikelihood: -25,
    };
    const fresh = resolveIdentity(candidates, evidence);
    const again = resolveIdentity(repeated, evidence);

    expect(again.best!.logScore).toBeLessThan(fresh.best!.logScore);
    // Soft, not absolute: a genuine re-run must still be recoverable.
    expect(Number.isFinite(again.best!.logScore)).toBe(true);
  });
});

describe("weight prediction", () => {
  it("widens with elapsed time, which is why the weight prior is a flywheel", () => {
    const base: Candidate = {
      animalId: "a",
      visualId: "1",
      tier: "session",
      lastWeightKg: 350,
      adgKgPerDay: 0.8,
    };
    const recent = predictWeight({ ...base, daysSinceLastWeight: 30 })!;
    const stale = predictWeight({ ...base, daysSinceLastWeight: 180 })!;

    expect(recent.expectedKg).toBeCloseTo(374, 0);
    expect(stale.sigmaKg).toBeGreaterThan(recent.sigmaKg);
    // Gut fill alone (2.5% of body weight) dominates at short intervals.
    expect(recent.sigmaKg).toBeGreaterThan(9);
  });

  it("returns nothing for an animal with no weight history", () => {
    expect(predictWeight({ animalId: "a", visualId: "1", tier: "session" })).toBeNull();
  });
});
