import type { BodyMeasurements } from "./depth.js";

/**
 * Turning body measurements into kilograms, with an interval rather than a
 * bare number.
 *
 * With a depth sensor the primary predictor is a measured volume, which is a
 * fundamentally better-conditioned input than a monocular silhouette's
 * projected area: area forces an assumed body depth, volume does not. Several
 * models are still run and fused, because their failure modes differ — a
 * volumetric model degrades when the cloud is gappy, an allometric model
 * survives that but is blunt.
 *
 * A word on the coefficients below. They are PRIORS, derived from body
 * geometry rather than fitted to a labelled herd, and they are labelled with
 * how well established each one is. They exist so a farm gets a plausible
 * number on day one; they are not a substitute for fitting against that
 * farm's own scale, which is what actually makes the system accurate. The
 * calibration loop that does the fitting is the thing that earns the accuracy,
 * not this table.
 */

export type SpeciesCode = "BOVINE" | "PORCINE" | "OVINE" | "CAPRINE" | "EQUINE";

/** How much confidence a coefficient set deserves before per-farm fitting. */
export type EstablishmentGrade =
  /** Derived from body geometry and sanity-checked; expect real bias. */
  | "provisional"
  /** Reflects a published relation for this species. */
  | "literature"
  /** Fitted against this farm's own scale weights. */
  | "fitted";

export interface SpeciesCoefficients {
  species: SpeciesCode;
  /** W = volumeA * V^volumeB, V in m^3 of heightmap volume. */
  volumeA: number;
  volumeB: number;
  /** W = areaA * A^areaB, A in m^2 of dorsal footprint. */
  areaA: number;
  areaB: number;
  /** W = boxA * (L*W*H)^boxB, all in metres. */
  boxA: number;
  boxB: number;
  /** W = lengthA * L^lengthB, L in metres. Blunt but robust. */
  lengthA: number;
  lengthB: number;
  grade: EstablishmentGrade;
  /** Expected relative residual of each model before fitting, as a fraction. */
  priorRelativeSigma: number;
}

/**
 * Provisional priors.
 *
 * Anchored on the observation that a heightmap volume runs roughly twice true
 * body volume — it includes the space under the belly and between the legs —
 * so the effective density is well below the ~1000 kg/m^3 of animal tissue.
 * The exponents are below 1 because that included dead space grows faster than
 * mass does as an animal gets larger.
 */
export const SPECIES_PRIORS: Record<SpeciesCode, SpeciesCoefficients> = {
  BOVINE: {
    species: "BOVINE",
    volumeA: 505,
    volumeB: 0.76,
    areaA: 560,
    areaB: 1.25,
    boxA: 480,
    boxB: 0.8,
    lengthA: 118,
    lengthB: 2.6,
    grade: "provisional",
    priorRelativeSigma: 0.1,
  },
  PORCINE: {
    species: "PORCINE",
    volumeA: 560,
    volumeB: 0.82,
    areaA: 340,
    areaB: 1.3,
    boxA: 520,
    boxB: 0.85,
    lengthA: 95,
    lengthB: 2.7,
    grade: "provisional",
    priorRelativeSigma: 0.12,
  },
  OVINE: {
    species: "OVINE",
    volumeA: 470,
    volumeB: 0.8,
    areaA: 200,
    areaB: 1.25,
    boxA: 450,
    boxB: 0.82,
    lengthA: 62,
    lengthB: 2.6,
    grade: "provisional",
    // Fleece is the problem: it adds volume without mass, and its depth
    // changes through the season. Expect this to be the worst species until
    // fitted, and to need refitting around shearing.
    priorRelativeSigma: 0.18,
  },
  CAPRINE: {
    species: "CAPRINE",
    volumeA: 460,
    volumeB: 0.8,
    areaA: 190,
    areaB: 1.25,
    boxA: 440,
    boxB: 0.82,
    lengthA: 58,
    lengthB: 2.6,
    grade: "provisional",
    priorRelativeSigma: 0.15,
  },
  EQUINE: {
    species: "EQUINE",
    volumeA: 520,
    volumeB: 0.78,
    areaA: 600,
    areaB: 1.22,
    boxA: 500,
    boxB: 0.8,
    lengthA: 130,
    lengthB: 2.55,
    grade: "provisional",
    priorRelativeSigma: 0.13,
  },
};

/** One model's opinion, with the uncertainty it claims. */
export interface ModelEstimate {
  model: "volumetric" | "area" | "box" | "allometric";
  weightKg: number;
  sigmaKg: number;
  /** False when the model's input was unusable, e.g. a gappy cloud. */
  usable: boolean;
}

/** A fused weight estimate with an honest interval. */
export interface WeightEstimate {
  weightKg: number;
  /** One-sigma total uncertainty, kg. */
  sigmaKg: number;
  /** 80% and 95% prediction intervals, kg. */
  interval80: [number, number];
  interval95: [number, number];
  /** Per-model breakdown, retained as evidence on the observation. */
  models: ModelEstimate[];
  /**
   * Birge ratio: observed spread between models over what their claimed
   * sigmas predict. Above 1 the models disagree more than they should, and
   * the interval is widened to match.
   */
  birgeRatio: number;
  /** Machine-readable concerns, mirrored into the observation's quality flags. */
  flags: string[];
}

function powerModel(value: number, a: number, b: number): number {
  return value > 0 ? a * Math.pow(value, b) : Number.NaN;
}

/**
 * Run every applicable model against one set of body measurements.
 *
 * A model is marked unusable rather than silently dropped, so the caller can
 * see that (say) the volumetric model abstained because the cloud was gappy.
 */
export function runModels(
  body: BodyMeasurements,
  coefficients: SpeciesCoefficients,
): ModelEstimate[] {
  const relSigma = coefficients.priorRelativeSigma;
  const estimates: ModelEstimate[] = [];

  // Volumetric — the strongest predictor when depth data is dense.
  const volumeWeight = powerModel(
    body.heightmapVolumeM3,
    coefficients.volumeA,
    coefficients.volumeB,
  );
  estimates.push({
    model: "volumetric",
    weightKg: volumeWeight,
    sigmaKg: volumeWeight * relSigma,
    // A sparse cloud under-integrates volume and silently under-weighs.
    usable: Number.isFinite(volumeWeight) && body.fillRatio >= 0.5,
  });

  const areaWeight = powerModel(
    body.dorsalAreaM2,
    coefficients.areaA,
    coefficients.areaB,
  );
  estimates.push({
    model: "area",
    weightKg: areaWeight,
    sigmaKg: areaWeight * relSigma * 1.3,
    usable: Number.isFinite(areaWeight),
  });

  const box = body.lengthM * body.widthM * body.heightM;
  const boxWeight = powerModel(box, coefficients.boxA, coefficients.boxB);
  estimates.push({
    model: "box",
    weightKg: boxWeight,
    sigmaKg: boxWeight * relSigma * 1.4,
    usable: Number.isFinite(boxWeight),
  });

  // Length alone: low information, high robustness. It is the anchor that
  // survives a partially occluded flank.
  const lengthWeight = powerModel(
    body.lengthM,
    coefficients.lengthA,
    coefficients.lengthB,
  );
  estimates.push({
    model: "allometric",
    weightKg: lengthWeight,
    sigmaKg: lengthWeight * relSigma * 1.8,
    usable: Number.isFinite(lengthWeight),
  });

  return estimates;
}

/**
 * Fuse the models by inverse-variance weighting, then widen the interval when
 * they disagree more than their claimed sigmas allow.
 *
 * The Birge inflation is what stops a confident-looking number emerging from
 * models that flatly contradict each other — the case that matters most,
 * because it is exactly what a partially occluded or mis-segmented animal
 * produces.
 */
export function fuseEstimates(
  estimates: readonly ModelEstimate[],
): WeightEstimate | null {
  const usable = estimates.filter(
    (e) => e.usable && Number.isFinite(e.weightKg) && e.sigmaKg > 0,
  );
  const flags: string[] = [];
  if (usable.length === 0) return null;
  if (usable.length < estimates.length) flags.push("vision_model_abstained");

  let weightSum = 0;
  let precisionSum = 0;
  for (const e of usable) {
    const precision = 1 / (e.sigmaKg * e.sigmaKg);
    weightSum += e.weightKg * precision;
    precisionSum += precision;
  }
  const mean = weightSum / precisionSum;
  const combinedSigma = Math.sqrt(1 / precisionSum);

  // Birge ratio: chi-square per degree of freedom of the model spread.
  let birgeRatio = 1;
  if (usable.length > 1) {
    let chi2 = 0;
    for (const e of usable) {
      chi2 += ((e.weightKg - mean) / e.sigmaKg) ** 2;
    }
    const reduced = chi2 / (usable.length - 1);
    birgeRatio = Math.sqrt(Math.max(reduced, 1));
    if (birgeRatio > 1.5) flags.push("vision_model_disagreement");
  }

  const sigma = combinedSigma * birgeRatio;
  return {
    weightKg: mean,
    sigmaKg: sigma,
    interval80: [mean - 1.2816 * sigma, mean + 1.2816 * sigma],
    interval95: [mean - 1.96 * sigma, mean + 1.96 * sigma],
    models: [...estimates],
    birgeRatio,
    flags,
  };
}

/**
 * Estimate weight from one pass's body measurements.
 *
 * `qualityPenalty` multiplies the final sigma for conditions the geometry
 * cannot see — a truncated body, a gappy cloud, a lens the operator has not
 * cleaned. Widening the interval is the honest response to degraded input;
 * narrowing the claim is not available.
 */
export function estimateWeight(
  body: BodyMeasurements,
  species: SpeciesCode,
  options: {
    coefficients?: SpeciesCoefficients;
    qualityPenalty?: number;
    truncated?: boolean;
  } = {},
): WeightEstimate | null {
  const coefficients = options.coefficients ?? SPECIES_PRIORS[species];
  const fused = fuseEstimates(runModels(body, coefficients));
  if (!fused) return null;

  const flags = [...fused.flags];
  let penalty = options.qualityPenalty ?? 1;

  if (options.truncated) {
    // A body touching the gate edge is measured short in at least one
    // dimension. Refusing is better than reporting, so this is surfaced as a
    // flag the caller is expected to act on.
    flags.push("vision_body_truncated");
    penalty *= 2;
  }
  if (body.fillRatio < 0.7) {
    flags.push("vision_sparse_cloud");
    penalty *= 1.5;
  }
  if (coefficients.grade === "provisional") {
    // Unfitted coefficients carry systematic bias that no amount of averaging
    // removes. Say so in the interval rather than in a footnote.
    flags.push("vision_uncalibrated_species_prior");
    penalty *= 1.6;
  }

  const sigma = fused.sigmaKg * penalty;
  return {
    ...fused,
    sigmaKg: sigma,
    interval80: [fused.weightKg - 1.2816 * sigma, fused.weightKg + 1.2816 * sigma],
    interval95: [fused.weightKg - 1.96 * sigma, fused.weightKg + 1.96 * sigma],
    flags,
  };
}
