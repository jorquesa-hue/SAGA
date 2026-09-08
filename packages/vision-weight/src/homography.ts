import { choleskySolve, invert3, jacobiEigen, matMul } from "./matrix.js";

/**
 * Plane-to-plane photogrammetry: mapping image pixels to metric coordinates on
 * a known physical plane, and reporting honestly how well-conditioned that
 * mapping is.
 *
 * Why this matters more than the weight model itself: with a dorsal-area
 * weight model W = a*A^b (b ~ 1.2-1.5, because area grows as L^2 while mass
 * grows as L^3), a 1% error in *linear* scale propagates to roughly 3% in
 * weight. Holding a 400 kg animal to +/-5% therefore demands linear scale good
 * to ~1.5%. That budget is what rules out hand-entered mount geometry: a 10 cm
 * eyeball error on a 4 m mount is 2.5% linear, 7.5% in weight, and nothing in
 * the image would contradict it.
 */

/** A pixel coordinate. */
export interface Point2 {
  x: number;
  y: number;
}

/** A correspondence between an image pixel and a known metric plane position. */
export interface Correspondence {
  /** Image coordinate, pixels. */
  pixel: Point2;
  /** Metric coordinate on the calibration plane, metres. */
  world: Point2;
}

/** A 3x3 homography plus the diagnostics that decide whether to trust it. */
export interface Homography {
  /** Row-major 3x3, normalised so h33 = 1. */
  matrix: number[][];
  /** RMS geometric reprojection error, in metres on the target plane. */
  reprojectionRmsM: number;
  /** Worst single-point reprojection error, metres. */
  reprojectionMaxM: number;
  /**
   * Degeneracy metric: second-smallest over largest eigenvalue of A^T A.
   * Deliberately not lambda_2/lambda_1 — on a near-exact fit lambda_1 tends to
   * zero (or a tiny negative from rounding) and that ratio explodes.
   */
  conditioning: number;
  /** Number of correspondences the fit consumed. */
  pointCount: number;
}

const MIN_CORRESPONDENCES = 4;

/** Apply a homography to a pixel, returning metric plane coordinates. */
export function applyHomography(h: readonly number[][], p: Point2): Point2 {
  const w = h[2]![0]! * p.x + h[2]![1]! * p.y + h[2]![2]!;
  return {
    x: (h[0]![0]! * p.x + h[0]![1]! * p.y + h[0]![2]!) / w,
    y: (h[1]![0]! * p.x + h[1]![1]! * p.y + h[1]![2]!) / w,
  };
}

interface Normalisation {
  transform: number[][];
  inverse: number[][];
}

/**
 * Hartley normalisation: translate to the centroid and scale so the mean
 * distance from the origin is sqrt(2).
 *
 * This is mandatory rather than cosmetic. Raw pixel coordinates mix magnitudes
 * of ~1e3 with 1, so the design matrix A has condition ~1e6 and A^T A ~1e12 —
 * four significant digits gone in float64. Normalised, cond(A) is ~10-100,
 * which is precisely what licenses solving via A^T A below.
 */
function normalise(points: readonly Point2[]): Normalisation {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p.x, 0) / n;
  const cy = points.reduce((s, p) => s + p.y, 0) / n;
  const meanDist =
    points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n || 1;
  const s = Math.SQRT2 / meanDist;
  return {
    transform: [
      [s, 0, -s * cx],
      [0, s, -s * cy],
      [0, 0, 1],
    ],
    inverse: [
      [1 / s, 0, cx],
      [0, 1 / s, cy],
      [0, 0, 1],
    ],
  };
}

function transformPoint(t: readonly number[][], p: Point2): Point2 {
  return {
    x: t[0]![0]! * p.x + t[0]![1]! * p.y + t[0]![2]!,
    y: t[1]![0]! * p.x + t[1]![1]! * p.y + t[1]![2]!,
  };
}

/**
 * Estimate a homography from >= 4 correspondences: normalised DLT for the
 * initial algebraic solution, then Levenberg-Marquardt to minimise true
 * geometric reprojection error (the DLT minimises an algebraic error, which is
 * biased; the LM residual is the number we are entitled to quote as accuracy).
 */
export function estimateHomography(
  correspondences: readonly Correspondence[],
): Homography | null {
  if (correspondences.length < MIN_CORRESPONDENCES) return null;

  const pixelNorm = normalise(correspondences.map((c) => c.pixel));
  const worldNorm = normalise(correspondences.map((c) => c.world));
  const pts = correspondences.map((c) => ({
    pixel: transformPoint(pixelNorm.transform, c.pixel),
    world: transformPoint(worldNorm.transform, c.world),
  }));

  // Build A (2n x 9) enforcing X~ cross (H x~) = 0, then solve A h = 0.
  const m: number[][] = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  for (const { pixel, world } of pts) {
    const { x: u, y: v } = pixel;
    const { x, y } = world;
    const rows = [
      [-u, -v, -1, 0, 0, 0, x * u, x * v, x],
      [0, 0, 0, -u, -v, -1, y * u, y * v, y],
    ];
    // Accumulate A^T A directly; with normalised coordinates this is safe.
    for (const row of rows) {
      for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) m[i]![j] = m[i]![j]! + row[i]! * row[j]!;
      }
    }
  }

  const eigen = jacobiEigen(m);
  const h = eigen.vectors[0]!;
  const largest = Math.abs(eigen.values[8]!) || 1;
  const conditioning = Math.abs(eigen.values[1]!) / largest;

  let hNorm = [
    [h[0]!, h[1]!, h[2]!],
    [h[3]!, h[4]!, h[5]!],
    [h[6]!, h[7]!, h[8]!],
  ];

  hNorm = refineGeometric(hNorm, pts);

  // Denormalise: H = inv(T_world) * H~ * T_pixel.
  const denorm = matMul(matMul(worldNorm.inverse, hNorm), pixelNorm.transform);
  const h33 = denorm[2]![2]!;
  if (!Number.isFinite(h33) || Math.abs(h33) < 1e-12) return null;
  const matrix = denorm.map((row) => row.map((value) => value / h33));

  let sumSq = 0;
  let max = 0;
  for (const c of correspondences) {
    const projected = applyHomography(matrix, c.pixel);
    const err = Math.hypot(projected.x - c.world.x, projected.y - c.world.y);
    sumSq += err * err;
    max = Math.max(max, err);
  }

  return {
    matrix,
    reprojectionRmsM: Math.sqrt(sumSq / correspondences.length),
    reprojectionMaxM: max,
    conditioning,
    pointCount: correspondences.length,
  };
}

/**
 * Levenberg-Marquardt refinement over the 8 free parameters (h33 pinned to 1),
 * minimising geometric residuals in metres. Runs in the normalised frame.
 */
function refineGeometric(
  initial: readonly number[][],
  pts: ReadonlyArray<{ pixel: Point2; world: Point2 }>,
): number[][] {
  // Parameterise with h33 == 1.
  const scale = initial[2]![2]!;
  if (!Number.isFinite(scale) || Math.abs(scale) < 1e-12)
    return initial.map((r) => [...r]);
  let theta = [
    initial[0]![0]! / scale,
    initial[0]![1]! / scale,
    initial[0]![2]! / scale,
    initial[1]![0]! / scale,
    initial[1]![1]! / scale,
    initial[1]![2]! / scale,
    initial[2]![0]! / scale,
    initial[2]![1]! / scale,
  ];

  const toMatrix = (t: readonly number[]): number[][] => [
    [t[0]!, t[1]!, t[2]!],
    [t[3]!, t[4]!, t[5]!],
    [t[6]!, t[7]!, 1],
  ];

  const cost = (t: readonly number[]): number => {
    const h = toMatrix(t);
    let sum = 0;
    for (const p of pts) {
      const q = applyHomography(h, p.pixel);
      sum += (q.x - p.world.x) ** 2 + (q.y - p.world.y) ** 2;
    }
    return sum;
  };

  let mu = 1e-3;
  let current = cost(theta);

  for (let iter = 0; iter < 50; iter++) {
    const jtj: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
    const jtr = new Array<number>(8).fill(0);
    const h = toMatrix(theta);

    for (const p of pts) {
      const { x: u, y: v } = p.pixel;
      const w = theta[6]! * u + theta[7]! * v + 1;
      const q = applyHomography(h, p.pixel);
      const rx = q.x - p.world.x;
      const ry = q.y - p.world.y;

      // Analytic Jacobian rows; the same partials give the local scale below.
      const drx = [u / w, v / w, 1 / w, 0, 0, 0, (-q.x * u) / w, (-q.x * v) / w];
      const dry = [0, 0, 0, u / w, v / w, 1 / w, (-q.y * u) / w, (-q.y * v) / w];

      for (let i = 0; i < 8; i++) {
        jtr[i] = jtr[i]! + drx[i]! * rx + dry[i]! * ry;
        for (let j = 0; j < 8; j++) {
          jtj[i]![j] = jtj[i]![j]! + drx[i]! * drx[j]! + dry[i]! * dry[j]!;
        }
      }
    }

    let accepted = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const damped = jtj.map((row, i) =>
        row.map((value, j) => (i === j ? value * (1 + mu) + 1e-12 : value)),
      );
      const delta = choleskySolve(
        damped,
        jtr.map((value) => -value),
      );
      if (!delta) {
        mu *= 10;
        continue;
      }
      const candidate = theta.map((value, i) => value + delta[i]!);
      const candidateCost = cost(candidate);
      if (Number.isFinite(candidateCost) && candidateCost < current) {
        theta = candidate;
        current = candidateCost;
        mu = Math.max(mu / 10, 1e-12);
        accepted = true;
        const maxStep = Math.max(...delta.map((d) => Math.abs(d)));
        if (maxStep < 1e-12) return toMatrix(theta);
        break;
      }
      mu *= 10;
    }
    if (!accepted) break;
  }

  return toMatrix(theta);
}

/**
 * Local metric scale at a pixel, derived from the homography's Jacobian.
 *
 * A single global "metres per pixel" factor is wrong for any camera that is
 * not perfectly nadir-pointing: scale varies across the frame. Callers use
 * `areaM2PerPx2` to convert a silhouette's pixel area, and `anisotropy` to
 * refuse measurements from parts of the frame that are too obliquely viewed.
 */
export interface LocalScale {
  /** Area element, m^2 per px^2. */
  areaM2PerPx2: number;
  /** Larger singular value of the Jacobian, m/px. */
  maxMetresPerPx: number;
  /** Smaller singular value of the Jacobian, m/px. */
  minMetresPerPx: number;
  /** Ratio of singular values, 1 = locally isotropic. Higher = more oblique. */
  anisotropy: number;
}

export function localScaleAt(h: readonly number[][], p: Point2): LocalScale {
  const w = h[2]![0]! * p.x + h[2]![1]! * p.y + h[2]![2]!;
  const q = applyHomography(h, p);
  // J = (1/w) * [[h11 - qx*h31, h12 - qx*h32], [h21 - qy*h31, h22 - qy*h32]]
  const j11 = (h[0]![0]! - q.x * h[2]![0]!) / w;
  const j12 = (h[0]![1]! - q.x * h[2]![1]!) / w;
  const j21 = (h[1]![0]! - q.y * h[2]![0]!) / w;
  const j22 = (h[1]![1]! - q.y * h[2]![1]!) / w;

  const det = Math.abs(j11 * j22 - j12 * j21);
  // Singular values of the 2x2 Jacobian, via the closed form.
  const e = (j11 * j11 + j12 * j12 + j21 * j21 + j22 * j22) / 2;
  const f = Math.sqrt(Math.max(e * e - det * det, 0));
  const sMax = Math.sqrt(Math.max(e + f, 0));
  const sMin = Math.sqrt(Math.max(e - f, 0));

  return {
    areaM2PerPx2: det,
    maxMetresPerPx: sMax,
    minMetresPerPx: sMin,
    anisotropy: sMin > 0 ? sMax / sMin : Number.POSITIVE_INFINITY,
  };
}

/**
 * Fitzgibbon one-parameter division model for radial lens distortion, with the
 * principal point pinned to the image centre.
 *
 * A homography absorbs linear and first-order perspective terms but not the
 * anisotropic radial warp, so on a wide lens the residual survives calibration
 * and silently biases every measurement. Estimating one parameter avoids
 * demanding a full checkerboard intrinsics session from a farm installer.
 */
export interface DistortionModel {
  /** Division-model coefficient; 0 means "no correction". */
  lambda: number;
  /** Image width, pixels. */
  width: number;
  /** Image height, pixels. */
  height: number;
}

export function undistort(model: DistortionModel, p: Point2): Point2 {
  if (model.lambda === 0) return p;
  const u0 = model.width / 2;
  const v0 = model.height / 2;
  const rho = Math.hypot(model.width, model.height) / 2;
  const xd = (p.x - u0) / rho;
  const yd = (p.y - v0) / rho;
  const denom = 1 + model.lambda * (xd * xd + yd * yd);
  return { x: u0 + (rho * xd) / denom, y: v0 + (rho * yd) / denom };
}

/**
 * Golden-section search for the distortion coefficient that minimises the
 * refined reprojection error. The objective is smooth and unimodal over this
 * interval, so ~40 evaluations resolve lambda to about 1e-4.
 */
export function estimateDistortion(
  correspondences: readonly Correspondence[],
  width: number,
  height: number,
): { model: DistortionModel; homography: Homography } | null {
  const evaluate = (lambda: number): Homography | null => {
    const model: DistortionModel = { lambda, width, height };
    return estimateHomography(
      correspondences.map((c) => ({
        pixel: undistort(model, c.pixel),
        world: c.world,
      })),
    );
  };

  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = -1.0;
  let hi = 0.2;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  let fc = evaluate(c)?.reprojectionRmsM ?? Number.POSITIVE_INFINITY;
  let fd = evaluate(d)?.reprojectionRmsM ?? Number.POSITIVE_INFINITY;

  for (let i = 0; i < 40 && hi - lo > 1e-4; i++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - phi * (hi - lo);
      fc = evaluate(c)?.reprojectionRmsM ?? Number.POSITIVE_INFINITY;
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + phi * (hi - lo);
      fd = evaluate(d)?.reprojectionRmsM ?? Number.POSITIVE_INFINITY;
    }
  }

  const lambda = (lo + hi) / 2;
  const homography = evaluate(lambda);
  if (!homography) return null;
  return { model: { lambda, width, height }, homography };
}

/** Inverse homography (metric plane back to pixels), or null if singular. */
export function invertHomography(h: readonly number[][]): number[][] | null {
  return invert3(h);
}
