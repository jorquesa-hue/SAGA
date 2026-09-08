import { logAdd } from "./ctc.js";

/**
 * Identity posterior: fusing every independent channel that says which animal
 * just walked through.
 *
 * No single channel is good enough on its own. Tag OCR is ~92-97% per read;
 * the weight is only weak evidence on its own because lot-mates weigh
 * similarly; the lot roster is a prior, not an observation. Fused, and with
 * everything that stays ambiguous routed to human review, per-animal records
 * become trustworthy — which is the whole point of the exercise.
 */

/** Which pool of animals a candidate was drawn from. */
export type CandidateTier = "session" | "farm" | "tenant";

/** Prior probability mass assigned to each tier, spread across its members. */
export interface TierPriors {
  session: number;
  farm: number;
  tenant: number;
  /** Mass reserved for "this animal is not in our roster at all". */
  outOfSet: number;
}

/**
 * Defaults: the animals declared for this session carry almost all the mass,
 * but nothing is ever hard-zeroed — an undeclared animal walking the race is a
 * real event, not an impossibility.
 */
export const DEFAULT_TIER_PRIORS: TierPriors = {
  session: 0.97,
  farm: 0.025,
  tenant: 0.004,
  outOfSet: 0.001,
};

/** Uncertainty budget for predicting an animal's weight forward in time. */
export interface WeightPriorConfig {
  /** Uncertainty of the previous recorded weight, kg. */
  lastWeightSigmaKg: number;
  /** Biological random-walk variance, kg^2 per day. */
  randomWalkKg2PerDay: number;
  /** Individual deviation from the assumed growth rate, kg/day. */
  adgSigmaKgPerDay: number;
  /**
   * Gut fill and shrink, as a fraction of body weight. Off-pasture shrink
   * reaches 3-5%, so this term is not optional — it is often the largest.
   */
  fillFraction: number;
  /** Clamp on how many nats the weight term may contribute either way. */
  clampNats: number;
  /** Sigma multiple beyond which identity is refused outright. */
  vetoSigma: number;
}

export const DEFAULT_WEIGHT_PRIOR: WeightPriorConfig = {
  lastWeightSigmaKg: 3,
  randomWalkKg2PerDay: 0.8,
  adgSigmaKgPerDay: 0.2,
  fillFraction: 0.025,
  clampNats: 6,
  vetoSigma: 2.8,
};

/** One animal that could plausibly be the one on camera. */
export interface Candidate {
  animalId: string;
  visualId: string;
  tier: CandidateTier;
  /** Most recent eligible weight, kg, if any. */
  lastWeightKg?: number;
  /** Days since that weight was taken. */
  daysSinceLastWeight?: number;
  /** Average daily gain, kg/day, from the animal's own history or its lot. */
  adgKgPerDay?: number;
  /** Passes already attributed to this animal in the current session. */
  alreadyAssignedCount?: number;
}

/** Evidence gathered for a single animal pass. */
export interface PassEvidence {
  /**
   * Tag log-likelihood per candidate animal id, already frame-fused and
   * discounted. Absent entries are treated as "the tag says nothing".
   */
  tagLogLikelihoodByAnimalId?: ReadonlyMap<string, number>;
  /** Tag log-likelihood of the best unconstrained decode, for the out-of-set case. */
  outOfSetTagLogLikelihood?: number;
  /** Camera weight estimate for this pass, kg. */
  estimatedWeightKg?: number;
  /** One-sigma uncertainty of that estimate, kg. */
  estimatedWeightSigmaKg?: number;
  /**
   * Animal id resolved from an RFID read, if one is present. RFID is
   * authoritative: when it resolves, it decides.
   */
  rfidAnimalId?: string;
  /** True when an RFID was read but matched no animal in this tenant. */
  rfidUnresolved?: boolean;
}

/** Per-candidate score breakdown, retained so a human can audit any decision. */
export interface CandidateScore {
  animalId: string;
  visualId: string;
  /** Total unnormalised log score. */
  logScore: number;
  /** Individual contributions, in nats. */
  terms: {
    tierPrior: number;
    repeatPenalty: number;
    tag: number;
    weight: number;
    rfid: number;
  };
  /** Calibrated posterior probability. */
  posterior: number;
  /** How far the camera weight sits from this candidate's prediction, in sigma. */
  weightSigmaDistance?: number;
}

/** What the system decided to do with a pass. */
export type IdentityDecision = "auto_accept" | "review" | "no_identity";

export interface IdentityResult {
  decision: IdentityDecision;
  /** Best candidate, absent when the evidence points out of the roster. */
  best?: CandidateScore;
  /** Ranked alternatives, retained as evidence for the review queue. */
  ranked: CandidateScore[];
  /** Posterior assigned to "not an animal in our roster". */
  outOfSetPosterior: number;
  /** Log-odds margin between the best and second-best hypothesis, in nats. */
  marginNats: number;
  /** Machine-readable reasons, mirrored into the observation's quality flags. */
  flags: string[];
}

/** Thresholds governing when the system is allowed to decide on its own. */
export interface DecisionThresholds {
  /** Minimum calibrated posterior for the top candidate. */
  minPosterior: number;
  /** Minimum log-odds margin over the runner-up, in nats. */
  minMarginNats: number;
  /** Temperature used to calibrate raw posteriors; > 1 softens overconfidence. */
  temperature: number;
}

/**
 * Defaults chosen for a target of under 0.1% wrong attributions. They are
 * deliberately strict: a wrong attribution corrupts two animals' growth curves
 * and is nearly undetectable months later, whereas a review is one tap.
 */
export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  minPosterior: 0.995,
  minMarginNats: 5.3,
  temperature: 1.0,
};

/** Predicted weight and its uncertainty for a candidate at pass time. */
export function predictWeight(
  candidate: Candidate,
  config: WeightPriorConfig = DEFAULT_WEIGHT_PRIOR,
): { expectedKg: number; sigmaKg: number } | null {
  if (candidate.lastWeightKg === undefined) return null;
  const days = candidate.daysSinceLastWeight ?? 0;
  const adg = candidate.adgKgPerDay ?? 0;
  const expectedKg = candidate.lastWeightKg + adg * days;

  const fill = config.fillFraction * expectedKg;
  const variance =
    config.lastWeightSigmaKg ** 2 +
    config.randomWalkKg2PerDay * days +
    (config.adgSigmaKgPerDay * days) ** 2 +
    fill ** 2;

  return { expectedKg, sigmaKg: Math.sqrt(variance) };
}

function gaussianLogLikelihood(value: number, mean: number, sigma: number): number {
  const z = (value - mean) / sigma;
  return -0.5 * Math.log(2 * Math.PI * sigma * sigma) - 0.5 * z * z;
}

/**
 * Score every candidate for one pass and decide.
 *
 * When an RFID read resolves, it wins outright — vision becomes a cross-check
 * rather than the decision. That cross-check is genuinely valuable: a confident
 * tag read that disagrees with the chip is a swapped or mis-applied tag, a real
 * and normally invisible corruption of the herd record.
 */
export function resolveIdentity(
  candidates: readonly Candidate[],
  evidence: PassEvidence,
  options: {
    tiers?: TierPriors;
    weightPrior?: WeightPriorConfig;
    thresholds?: DecisionThresholds;
    /** Log-probability that a given animal legitimately re-runs the race. */
    repeatLogPenalty?: number;
  } = {},
): IdentityResult {
  const tiers = options.tiers ?? DEFAULT_TIER_PRIORS;
  const weightConfig = options.weightPrior ?? DEFAULT_WEIGHT_PRIOR;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const repeatLogPenalty = options.repeatLogPenalty ?? Math.log(0.02);
  const flags: string[] = [];

  const tierCounts = { session: 0, farm: 0, tenant: 0 };
  for (const c of candidates) tierCounts[c.tier]++;

  const scores: CandidateScore[] = [];

  for (const candidate of candidates) {
    const tierSize = tierCounts[candidate.tier] || 1;
    const tierMass = tiers[candidate.tier];
    const tierPrior = Math.log(tierMass / tierSize);

    const repeats = candidate.alreadyAssignedCount ?? 0;
    // A soft penalty, never a hard zero: hard-zeroing an already-assigned
    // animal locks in an earlier mistake instead of letting the session-level
    // assignment correct it.
    const repeatPenalty = repeats * repeatLogPenalty;

    const tag = evidence.tagLogLikelihoodByAnimalId?.get(candidate.animalId) ?? 0;

    let weight = 0;
    let weightSigmaDistance: number | undefined;
    if (
      evidence.estimatedWeightKg !== undefined &&
      evidence.estimatedWeightSigmaKg !== undefined
    ) {
      const predicted = predictWeight(candidate, weightConfig);
      if (predicted) {
        const sigma = Math.sqrt(
          evidence.estimatedWeightSigmaKg ** 2 + predicted.sigmaKg ** 2,
        );
        weightSigmaDistance =
          Math.abs(evidence.estimatedWeightKg - predicted.expectedKg) / sigma;
        const raw = gaussianLogLikelihood(
          evidence.estimatedWeightKg,
          predicted.expectedKg,
          sigma,
        );
        // Clamped so a mis-specified growth rate or a sick animal can never
        // override a clean multi-frame tag read.
        weight = Math.max(-weightConfig.clampNats, Math.min(weightConfig.clampNats, raw));
      }
    }

    let rfid = 0;
    if (evidence.rfidAnimalId) {
      rfid = evidence.rfidAnimalId === candidate.animalId ? 0 : Number.NEGATIVE_INFINITY;
    }

    const logScore = tierPrior + repeatPenalty + tag + weight + rfid;
    scores.push({
      animalId: candidate.animalId,
      visualId: candidate.visualId,
      logScore,
      terms: { tierPrior, repeatPenalty, tag, weight, rfid },
      posterior: 0,
      weightSigmaDistance,
    });
  }

  // The out-of-set hypothesis competes on the same scale as the candidates.
  const outOfSetLogScore = evidence.rfidAnimalId
    ? Number.NEGATIVE_INFINITY
    : Math.log(tiers.outOfSet) + (evidence.outOfSetTagLogLikelihood ?? 0);

  // Normalise with temperature calibration; raw posteriors are overconfident.
  const t = thresholds.temperature || 1;
  const allLogScores = [...scores.map((s) => s.logScore / t), outOfSetLogScore / t];
  let normaliser = Number.NEGATIVE_INFINITY;
  for (const value of allLogScores) normaliser = logAdd(normaliser, value);

  for (const score of scores) {
    score.posterior = Math.exp(score.logScore / t - normaliser);
  }
  const outOfSetPosterior = Math.exp(outOfSetLogScore / t - normaliser);

  scores.sort((a, b) => b.logScore - a.logScore);
  const best = scores[0];
  const runnerUp = scores[1];

  if (!best || !Number.isFinite(best.logScore)) {
    return {
      decision: "no_identity",
      ranked: [],
      outOfSetPosterior: 1,
      marginNats: 0,
      flags: ["no_identity_candidate"],
    };
  }

  // Margin against the strongest alternative, including "not in the roster".
  const bestAlternative = Math.max(
    runnerUp?.logScore ?? Number.NEGATIVE_INFINITY,
    outOfSetLogScore,
  );
  const marginNats = Number.isFinite(bestAlternative)
    ? best.logScore - bestAlternative
    : Number.POSITIVE_INFINITY;

  if (evidence.rfidAnimalId) {
    flags.push("identity_rfid");
    // Cross-check: a confident tag read pointing elsewhere means the chip and
    // the visual tag disagree — worth surfacing, never silently overridden.
    const tagBest = [...scores]
      .filter((s) => Number.isFinite(s.terms.tag) && s.terms.tag !== 0)
      .sort((a, b) => b.terms.tag - a.terms.tag)[0];
    if (tagBest && tagBest.animalId !== evidence.rfidAnimalId) {
      flags.push("tag_chip_mismatch");
      return {
        decision: "review",
        best,
        ranked: scores.slice(0, 10),
        outOfSetPosterior,
        marginNats,
        flags,
      };
    }
    return {
      decision: "auto_accept",
      best,
      ranked: scores.slice(0, 10),
      outOfSetPosterior,
      marginNats,
      flags,
    };
  }

  if (evidence.rfidUnresolved) flags.push("rfid_unresolved");

  // The weight veto. Weight evidence is asymmetric: agreement is weak because
  // lot-mates weigh alike, but a large disagreement is strong. Spend its
  // statistical power as a gate rather than only as a term.
  if (
    best.weightSigmaDistance !== undefined &&
    best.weightSigmaDistance > weightConfig.vetoSigma
  ) {
    flags.push("weight_identity_conflict");
    return {
      decision: "review",
      best,
      ranked: scores.slice(0, 10),
      outOfSetPosterior,
      marginNats,
      flags,
    };
  }

  if (outOfSetPosterior > best.posterior) {
    flags.push("animal_not_in_roster");
    return {
      decision: "no_identity",
      ranked: scores.slice(0, 10),
      outOfSetPosterior,
      marginNats,
      flags,
    };
  }

  if (best.posterior >= thresholds.minPosterior && marginNats >= thresholds.minMarginNats) {
    return {
      decision: "auto_accept",
      best,
      ranked: scores.slice(0, 10),
      outOfSetPosterior,
      marginNats,
      flags,
    };
  }

  // Report every reason that held the decision back, not just the first one:
  // a reviewer seeing both "weak posterior" and "close rival" understands the
  // situation differently from either alone.
  if (best.posterior < thresholds.minPosterior) flags.push("low_identity_posterior");
  if (marginNats < thresholds.minMarginNats) flags.push("low_identity_margin");
  return {
    decision: "review",
    best,
    ranked: scores.slice(0, 10),
    outOfSetPosterior,
    marginNats,
    flags,
  };
}
