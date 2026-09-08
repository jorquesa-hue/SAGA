import { applyHomography, type Homography, type Point2 } from "./homography.js";
import { choleskySolve } from "./matrix.js";

/**
 * MONOCULAR FALLBACK PATH. The primary acquisition mode is a depth sensor
 * (see ./depth.ts), which MEASURES metric scale and the animal's back height
 * per pixel and therefore needs none of the machinery in this file.
 *
 * This module is retained for the degraded tier: a farm running a plain RGB
 * camera, or a depth sensor operating outside its usable range or washed out
 * by direct sun. It is deliberately not deleted, because the acquisition layer
 * is meant to be swappable — but it is NOT the path to reason about first, and
 * everything it computes carries materially more uncertainty than the depth
 * equivalent.
 *
 * ---
 *
 * Two-plane geometry: recovering the camera's height above the ground and the
 * nadir point (where the optical axis meets the ground), using nothing but two
 * homographies calibrated at two known heights.
 *
 * The point of this module is to defeat the single largest systematic error in
 * top-down camera weighing. A homography calibrated on the FLOOR reports where
 * a ray pierces the floor — but an animal's back is 1.2-1.4 m above it, so the
 * animal's silhouette is magnified. Uncorrected, that inflates every linear
 * measurement by ~40% at a 4 m mount, which the weight model then cubes.
 *
 * The derivation. With the ground at Z = 0 and the camera centre C at height
 * H_cam, a point P at height h images exactly where the ray C->P pierces Z = 0.
 * Solving 0 = H_cam + (h - H_cam)*t gives t = H_cam/(H_cam - h), so
 *
 *     P_ground = C_xy + (P_xy - C_xy) * H_cam/(H_cam - h)
 *
 * That is: the ground homography magnifies anything at height h by
 * mu = H_cam/(H_cam - h), about the nadir. Two calibration planes let us
 * measure mu directly and solve for both unknowns.
 */

/** Recovered camera geometry, with the diagnostics that gate its use. */
export interface CameraGeometry {
  /** Camera centre height above the ground plane, metres. */
  cameraHeightM: number;
  /** Ground-plane position directly beneath the camera centre, metres. */
  nadir: Point2;
  /** Measured magnification of the elevated plane, strictly > 1. */
  magnification: number;
  /** RMS of the scale-and-translate fit, metres. Small = consistent planes. */
  residualM: number;
  /**
   * Sensitivity dH_cam/dmu at the solution, metres per unit mu. This blows up
   * as mu approaches 1, which is the formal reason the reference board must be
   * mounted high — ideally at dorsal height, where the animal is measured.
   */
  heightSensitivityM: number;
}

/**
 * The reference board must sit at least this fraction of the camera height
 * above the ground for the two planes to be separable. At the recommended
 * placement (a 1.3 m board under a 4 m mount, ratio 0.325) the height solve's
 * sensitivity is a manageable -5.6 m per unit mu; at ratio 0.05 it is already
 * -72 m and the answer is noise.
 */
const MIN_HEIGHT_RATIO = 0.1;

/**
 * The animal's back must stay below this fraction of the camera height.
 *
 * The parallax correction multiplies ground-plane lengths by (1 - h/H), so at
 * h/H = 0.5 the correction is 0.5 and an error in the assumed back height is
 * halved in the result; at h/H = 0.97 the factor is 0.03 and the same error is
 * amplified more than thirtyfold. Everything above this ratio is a mount that
 * is simply too low for the species being weighed.
 */
const MAX_DORSAL_HEIGHT_RATIO = 0.5;

/** Rejection reasons that a calibration can fail with, for operator messaging. */
export type GeometryFailure =
  "insufficient_points" | "planes_indistinguishable" | "degenerate_fit";

export interface GeometryResult {
  ok: boolean;
  geometry?: CameraGeometry;
  failure?: GeometryFailure;
}

/**
 * Solve for camera height and nadir from the two calibrated planes.
 *
 * `pixels` are the detected image points of the ELEVATED board. Each is mapped
 * twice: through the elevated homography (giving its true metric position at
 * `referenceHeightM`) and through the ground homography (giving its inflated
 * ground footprint). The relation between the two is a pure scale-plus-
 * translation with no rotation — 3 unknowns, 2 equations per point.
 */
export function solveTwoPlaneGeometry(
  pixels: readonly Point2[],
  groundPlane: Homography,
  elevatedPlane: Homography,
  referenceHeightM: number,
): GeometryResult {
  if (pixels.length < 2) return { ok: false, failure: "insufficient_points" };
  if (!(referenceHeightM > 0)) return { ok: false, failure: "planes_indistinguishable" };

  // q = mu*p + t, unknowns (mu, tx, ty).
  const ata: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atb = [0, 0, 0];

  for (const pixel of pixels) {
    const p = applyHomography(elevatedPlane.matrix, pixel);
    const q = applyHomography(groundPlane.matrix, pixel);
    // Row for x: [p.x, 1, 0] . (mu, tx, ty) = q.x
    // Row for y: [p.y, 0, 1] . (mu, tx, ty) = q.y
    const rows: Array<{ a: number[]; b: number }> = [
      { a: [p.x, 1, 0], b: q.x },
      { a: [p.y, 0, 1], b: q.y },
    ];
    for (const { a, b } of rows) {
      for (let i = 0; i < 3; i++) {
        atb[i] = atb[i]! + a[i]! * b;
        for (let j = 0; j < 3; j++) ata[i]![j] = ata[i]![j]! + a[i]! * a[j]!;
      }
    }
  }

  const solution = choleskySolve(ata, atb);
  if (!solution) return { ok: false, failure: "degenerate_fit" };

  const [mu, tx, ty] = [solution[0]!, solution[1]!, solution[2]!];

  // mu must exceed 1 strictly: an elevated plane is always magnified.
  //
  // But "mu > 1" is far too weak a test on its own. The height solve has
  // sensitivity dH_cam/dmu = -h_ref/(mu-1)^2, which explodes as mu -> 1: a
  // board 5 mm off the floor on a 4 m mount gives mu = 1.00125 and a
  // sensitivity of -3192 m per unit mu, so noise in the corner detections
  // produces a wild camera height with no outward sign of trouble.
  //
  // The honest criterion is therefore a floor on the height RATIO, since
  // h/H = (mu-1)/mu. Below MIN_HEIGHT_RATIO the two planes are not
  // meaningfully separated and the operator must raise the reference board.
  if (!Number.isFinite(mu) || mu <= 1) {
    return { ok: false, failure: "planes_indistinguishable" };
  }
  const heightRatio = (mu - 1) / mu;
  if (heightRatio < MIN_HEIGHT_RATIO) {
    return { ok: false, failure: "planes_indistinguishable" };
  }

  const cameraHeightM = (referenceHeightM * mu) / (mu - 1);
  const nadir: Point2 = { x: tx / (1 - mu), y: ty / (1 - mu) };

  let sumSq = 0;
  for (const pixel of pixels) {
    const p = applyHomography(elevatedPlane.matrix, pixel);
    const q = applyHomography(groundPlane.matrix, pixel);
    sumSq += (mu * p.x + tx - q.x) ** 2 + (mu * p.y + ty - q.y) ** 2;
  }

  return {
    ok: true,
    geometry: {
      cameraHeightM,
      nadir,
      magnification: mu,
      residualM: Math.sqrt(sumSq / (pixels.length * 2)),
      heightSensitivityM: -referenceHeightM / (mu - 1) ** 2,
    },
  };
}

/**
 * Project a ground-plane measurement back to its true position at height `h`.
 *
 * This is the inverse of the magnification above: a point observed on the
 * ground plane, but physically at height h, actually sits at
 *
 *     p_true = nadir + (p_ground - nadir) * (1 - h/H_cam)
 *
 * Applied per landmark rather than as one global factor, because the animal's
 * topline and its flanks are at genuinely different heights.
 */
export function correctForHeight(
  groundPoint: Point2,
  geometry: Pick<CameraGeometry, "cameraHeightM" | "nadir">,
  heightM: number,
): Point2 {
  const k = 1 - heightM / geometry.cameraHeightM;
  return {
    x: geometry.nadir.x + (groundPoint.x - geometry.nadir.x) * k,
    y: geometry.nadir.y + (groundPoint.y - geometry.nadir.y) * k,
  };
}

/** Linear scale factor applied to lengths measured on the ground plane. */
export function heightScaleFactor(
  geometry: Pick<CameraGeometry, "cameraHeightM">,
  heightM: number,
): number {
  return 1 - heightM / geometry.cameraHeightM;
}

/**
 * Species-specific relation between torso length and dorsal (topline) height,
 * h_back ~ alpha + beta * L. Used to break the circular dependency below.
 */
export interface DorsalHeightPrior {
  /** Intercept, metres. */
  alphaM: number;
  /** Slope, metres of height per metre of body length. */
  beta: number;
}

/**
 * Resolve the dorsal height, which is circular: correcting for parallax needs
 * the animal's back height, but back height is predicted from body length,
 * which is itself only known after the parallax correction.
 *
 * Solved with the closed-form initialiser
 *
 *     h* = (alpha + beta*L_g) / (1 + beta*L_g/H_cam)
 *
 * (the exact fixed point of the linearised system) followed by a few damped
 * iterations against the true relation. Damping at omega = 0.7 keeps this
 * stable for the shallow mounts where the map's gradient approaches 1.
 */
export function solveDorsalHeight(
  uncorrectedLengthM: number,
  geometry: Pick<CameraGeometry, "cameraHeightM">,
  prior: DorsalHeightPrior,
  iterations = 3,
  omega = 0.7,
): { heightM: number; correctedLengthM: number; converged: boolean } {
  const { alphaM, beta } = prior;
  const lg = uncorrectedLengthM;
  const h0 = (alphaM + beta * lg) / (1 + (beta * lg) / geometry.cameraHeightM);

  let h = h0;
  let previous = h0;
  let converged = false;
  for (let i = 0; i < iterations; i++) {
    const corrected = lg * heightScaleFactor(geometry, h);
    const target = alphaM + beta * corrected;
    h = omega * target + (1 - omega) * h;
    if (Math.abs(h - previous) < 1e-4) {
      converged = true;
      break;
    }
    previous = h;
  }
  // Refuse when the back sits too high a fraction of the camera height. A back
  // at or above the camera is outright impossible, but the dangerous case is
  // subtler: at h/H near 1 the correction factor approaches zero, so the solve
  // still converges on a plausible-LOOKING torso while amplifying every error
  // by 1/(1 - h/H). That is a mount too low for this species, not a weight.
  if (!(h > 0) || h >= geometry.cameraHeightM * MAX_DORSAL_HEIGHT_RATIO) {
    return { heightM: Number.NaN, correctedLengthM: Number.NaN, converged: false };
  }

  return {
    heightM: h,
    correctedLengthM: lg * heightScaleFactor(geometry, h),
    converged: converged || iterations <= 1,
  };
}

/**
 * Minimum mount height for a species, derived rather than chosen: high enough
 * that the largest expected animal's back stays under
 * MAX_DORSAL_HEIGHT_RATIO of the camera height, keeping the parallax
 * correction's error gradient at or below 0.5.
 *
 * This is the PHOTOGRAMMETRIC floor only. A real install is usually mounted
 * higher still, because the lens also has to cover the animal's whole length
 * plus margin — see `minimumMountHeightForCoverageM`. Take the larger of the
 * two.
 */
export function minimumMountHeightM(
  prior: DorsalHeightPrior,
  maxBodyLengthM: number,
): number {
  const backHeight = prior.alphaM + prior.beta * maxBodyLengthM;
  return backHeight / MAX_DORSAL_HEIGHT_RATIO;
}

/**
 * Minimum mount height so the camera's field of view covers the measurement
 * gate at the animal's dorsal plane (which is closer to the lens than the
 * ground, so it is the binding constraint).
 *
 * `horizontalFovDeg` is the lens's field of view along the race axis.
 */
export function minimumMountHeightForCoverageM(
  prior: DorsalHeightPrior,
  maxBodyLengthM: number,
  horizontalFovDeg: number,
  marginFactor = 1.3,
): number {
  const backHeight = prior.alphaM + prior.beta * maxBodyLengthM;
  const required = maxBodyLengthM * marginFactor;
  const halfFov = (horizontalFovDeg * Math.PI) / 360;
  // Working distance needed to span `required` metres across the FOV.
  const workingDistance = required / (2 * Math.tan(halfFov));
  return workingDistance + backHeight;
}

/**
 * Detect camera or fiducial pose drift in METRIC terms rather than pixels.
 *
 * Two independent channels: an induced scale change (which biases every weight
 * multiplicatively and is the dangerous one) and a rigid displacement of the
 * measurement gate (which mostly costs coverage). Reporting them separately
 * lets the operator be told which physically happened — the camera moved, or
 * the marker board moved.
 */
export interface DriftAssessment {
  /** Ratio of induced linear scale, 1.0 = unchanged. */
  scaleRatio: number;
  /** Largest displacement of the gate corners, metres. */
  displacementM: number;
  /** True when drift exceeds tolerance and estimates must be suspended. */
  exceedsTolerance: boolean;
}

export function assessDrift(
  reference: Homography,
  current: Homography,
  gateCornersPx: readonly Point2[],
  toleranceScale = 0.015,
  toleranceDisplacementM = 0.05,
): DriftAssessment {
  let maxDisplacement = 0;
  let scaleAccumulator = 0;
  let counted = 0;

  for (const corner of gateCornersPx) {
    const a = applyHomography(reference.matrix, corner);
    const b = applyHomography(current.matrix, corner);
    maxDisplacement = Math.max(maxDisplacement, Math.hypot(a.x - b.x, a.y - b.y));
  }

  // Compare pairwise distances between gate corners: a pure translation leaves
  // them unchanged, while a scale change shows up directly.
  for (let i = 0; i < gateCornersPx.length; i++) {
    for (let j = i + 1; j < gateCornersPx.length; j++) {
      const a0 = applyHomography(reference.matrix, gateCornersPx[i]!);
      const a1 = applyHomography(reference.matrix, gateCornersPx[j]!);
      const b0 = applyHomography(current.matrix, gateCornersPx[i]!);
      const b1 = applyHomography(current.matrix, gateCornersPx[j]!);
      const dA = Math.hypot(a0.x - a1.x, a0.y - a1.y);
      const dB = Math.hypot(b0.x - b1.x, b0.y - b1.y);
      if (dA > 1e-6) {
        scaleAccumulator += dB / dA;
        counted++;
      }
    }
  }

  const scaleRatio = counted > 0 ? scaleAccumulator / counted : 1;
  return {
    scaleRatio,
    displacementM: maxDisplacement,
    exceedsTolerance:
      Math.abs(scaleRatio - 1) > toleranceScale ||
      maxDisplacement > toleranceDisplacementM,
  };
}
