import { jacobiEigen } from "./matrix.js";

/**
 * Depth-camera body measurement.
 *
 * A depth sensor removes the hardest problem in camera weighing. A monocular
 * camera has to *infer* metric scale from a calibration target and then infer
 * the animal's back height to undo parallax — an error chain where 1% of
 * linear scale becomes ~3% of weight. A depth camera *measures* both, per
 * pixel, so the geometry stops being an inference problem and the remaining
 * error is sensor noise, which averages down over thousands of points.
 *
 * It also changes what we can measure. A silhouette gives a projected area and
 * forces an assumed body depth; a point cloud gives real volume, and volume
 * predicts mass far better than area does. That is the reason depth-based
 * commercial systems report 95-97% accuracy where monocular research systems
 * report 90-95%.
 *
 * Everything here is deterministic: no clock, no ambient randomness. The
 * robust plane fit takes an explicit seed so the same frames always yield the
 * same answer, which matters because these numbers become immutable domain
 * events an auditor may need to re-derive.
 */

/** Pinhole intrinsics for the depth stream, in pixels. */
export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/** A depth frame in metres. Zero or non-finite entries mean "no return". */
export interface DepthFrame {
  /** Row-major depth values, length = width * height, in metres. */
  depths: ArrayLike<number>;
  width: number;
  height: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** A plane in Hessian normal form: dot(normal, p) + offset = 0. */
export interface Plane {
  normal: Point3;
  offset: number;
}

function dot(a: Point3, b: Point3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Point3, b: Point3): Point3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function norm(a: Point3): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Deproject a depth frame into a metric point cloud in the camera's frame.
 *
 * `stride` subsamples the image; at 1280x720 a stride of 2 keeps ~230k points,
 * which is far more than enough for a body measurement and a quarter of the
 * work.
 */
export function deproject(
  frame: DepthFrame,
  intrinsics: CameraIntrinsics,
  options: { stride?: number; minDepthM?: number; maxDepthM?: number } = {},
): Point3[] {
  const stride = Math.max(1, Math.floor(options.stride ?? 1));
  const minDepth = options.minDepthM ?? 0.1;
  const maxDepth = options.maxDepthM ?? 10;
  const points: Point3[] = [];

  for (let v = 0; v < frame.height; v += stride) {
    for (let u = 0; u < frame.width; u += stride) {
      const d = frame.depths[v * frame.width + u];
      if (d === undefined || !Number.isFinite(d) || d < minDepth || d > maxDepth) {
        continue;
      }
      points.push({
        x: ((u - intrinsics.cx) * d) / intrinsics.fx,
        y: ((v - intrinsics.cy) * d) / intrinsics.fy,
        z: d,
      });
    }
  }
  return points;
}

/**
 * Total-least-squares plane fit (PCA): the plane normal is the eigenvector of
 * the smallest eigenvalue of the points' covariance.
 *
 * Deterministic and exact for clean data. Used both on its own — fitting the
 * empty race floor once at install, which is the operationally sensible thing
 * to do — and to refine RANSAC's inlier set.
 */
export function fitPlaneLeastSquares(points: readonly Point3[]): Plane | null {
  if (points.length < 3) return null;

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  const n = points.length;
  cx /= n;
  cy /= n;
  cz /= n;

  // Accumulate the six independent entries as scalars, then assemble; this
  // reads better than indexing a matrix inside the hot loop.
  let sxx = 0;
  let sxy = 0;
  let sxz = 0;
  let syy = 0;
  let syz = 0;
  let szz = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dz = p.z - cz;
    sxx += dx * dx;
    sxy += dx * dy;
    sxz += dx * dz;
    syy += dy * dy;
    syz += dy * dz;
    szz += dz * dz;
  }
  const cov = [
    [sxx, sxy, sxz],
    [sxy, syy, syz],
    [sxz, syz, szz],
  ];

  const eigen = jacobiEigen(cov);
  const v = eigen.vectors[0]!;
  const normal: Point3 = { x: v[0]!, y: v[1]!, z: v[2]! };
  const length = norm(normal);
  if (!(length > 0)) return null;

  const unit: Point3 = {
    x: normal.x / length,
    y: normal.y / length,
    z: normal.z / length,
  };
  return { normal: unit, offset: -dot(unit, { x: cx, y: cy, z: cz }) };
}

/** Signed distance from a point to a plane; positive is along the normal. */
export function signedDistance(plane: Plane, p: Point3): number {
  return dot(plane.normal, p) + plane.offset;
}

/**
 * Deterministic linear congruential generator.
 *
 * RANSAC needs sampling, but these measurements become immutable domain events
 * that an auditor must be able to re-derive exactly, so ambient randomness is
 * not acceptable. The seed is part of the calibration record.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Robust ground-plane fit by RANSAC, refined by least squares on the inliers.
 *
 * Needed because the floor is rarely alone in view: rails, muck, an animal's
 * legs and the race walls all contribute points that would drag a plain
 * least-squares fit off the true floor.
 */
export function fitGroundPlaneRansac(
  points: readonly Point3[],
  options: {
    inlierThresholdM?: number;
    iterations?: number;
    seed?: number;
  } = {},
): { plane: Plane; inlierCount: number; inlierFraction: number } | null {
  const threshold = options.inlierThresholdM ?? 0.02;
  const iterations = options.iterations ?? 200;
  const random = lcg(options.seed ?? 12345);
  if (points.length < 3) return null;

  let bestPlane: Plane | null = null;
  let bestCount = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const a = points[Math.floor(random() * points.length)]!;
    const b = points[Math.floor(random() * points.length)]!;
    const c = points[Math.floor(random() * points.length)]!;

    const ab: Point3 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac: Point3 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const n = cross(ab, ac);
    const length = norm(n);
    if (!(length > 1e-9)) continue;

    const unit: Point3 = { x: n.x / length, y: n.y / length, z: n.z / length };
    const plane: Plane = { normal: unit, offset: -dot(unit, a) };

    let count = 0;
    for (const p of points) {
      if (Math.abs(signedDistance(plane, p)) <= threshold) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestPlane = plane;
    }
  }

  if (!bestPlane) return null;

  // Refine on the consensus set — RANSAC finds the right plane, least squares
  // makes it accurate.
  const inliers = points.filter(
    (p) => Math.abs(signedDistance(bestPlane!, p)) <= threshold,
  );
  const refined = fitPlaneLeastSquares(inliers) ?? bestPlane;

  // Orient the normal so "up" (away from the floor, toward the camera) is
  // positive, which is what every height calculation downstream assumes.
  const oriented: Plane =
    signedDistance(refined, { x: 0, y: 0, z: 0 }) < 0
      ? {
          normal: { x: -refined.normal.x, y: -refined.normal.y, z: -refined.normal.z },
          offset: -refined.offset,
        }
      : refined;

  return {
    plane: oriented,
    inlierCount: inliers.length,
    inlierFraction: inliers.length / points.length,
  };
}

/** An axis-aligned metric region on the ground plane that a pass must fall inside. */
export interface MeasurementGate {
  /** Extent along the race axis, metres, centred on the gate origin. */
  alongM: number;
  /** Extent across the race, metres. */
  acrossM: number;
  /** Minimum height above the floor for a point to count as animal. */
  minHeightM: number;
  /** Maximum plausible height; taller points are rails, gates or people. */
  maxHeightM: number;
}

export const DEFAULT_GATE: MeasurementGate = {
  alongM: 2.6,
  acrossM: 1.4,
  minHeightM: 0.35,
  maxHeightM: 2.2,
};

/** An orthonormal frame on the ground plane: two in-plane axes plus the normal. */
export interface GroundFrame {
  origin: Point3;
  /** In-plane axis, conventionally along the race. */
  axisAlong: Point3;
  /** In-plane axis, across the race. */
  axisAcross: Point3;
  /** Plane normal, pointing up away from the floor. */
  up: Point3;
}

/**
 * Build a ground frame from the fitted plane. The in-plane axes are arbitrary
 * until the animal is measured; the body's own principal axis is what
 * ultimately defines "along", so this only needs to be a consistent basis.
 */
export function groundFrameFromPlane(plane: Plane, origin?: Point3): GroundFrame {
  const up = plane.normal;
  // Pick any vector not parallel to the normal to seed the basis.
  const seed: Point3 = Math.abs(up.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const a = cross(up, seed);
  const aLen = norm(a);
  const axisAlong: Point3 = { x: a.x / aLen, y: a.y / aLen, z: a.z / aLen };
  const axisAcross = cross(up, axisAlong);
  const projectedOrigin = origin ?? {
    x: -plane.offset * up.x,
    y: -plane.offset * up.y,
    z: -plane.offset * up.z,
  };
  return { origin: projectedOrigin, axisAlong, axisAcross, up };
}

/** A point expressed in ground-frame coordinates: along, across, height. */
export interface GroundPoint {
  along: number;
  across: number;
  height: number;
}

/** Express a camera-frame point in the ground frame. */
export function toGroundFrame(frame: GroundFrame, p: Point3): GroundPoint {
  const rel: Point3 = {
    x: p.x - frame.origin.x,
    y: p.y - frame.origin.y,
    z: p.z - frame.origin.z,
  };
  return {
    along: dot(rel, frame.axisAlong),
    across: dot(rel, frame.axisAcross),
    height: dot(rel, frame.up),
  };
}

/**
 * Isolate the animal: points above the floor, below the rails, and inside the
 * measurement gate.
 *
 * Deliberately conservative at the edges — a partially-visible animal must be
 * rejected rather than measured short, so `truncated` reports whether the body
 * touches the gate boundary.
 */
export function segmentAnimal(
  points: readonly Point3[],
  frame: GroundFrame,
  gate: MeasurementGate = DEFAULT_GATE,
): { body: GroundPoint[]; truncated: boolean } {
  const body: GroundPoint[] = [];
  let touchesEdge = false;
  const halfAlong = gate.alongM / 2;
  const halfAcross = gate.acrossM / 2;

  for (const p of points) {
    const g = toGroundFrame(frame, p);
    if (g.height < gate.minHeightM || g.height > gate.maxHeightM) continue;
    if (Math.abs(g.along) > halfAlong || Math.abs(g.across) > halfAcross) continue;
    body.push(g);
    if (Math.abs(g.along) > halfAlong - 0.05 || Math.abs(g.across) > halfAcross - 0.05) {
      touchesEdge = true;
    }
  }

  return { body, truncated: touchesEdge };
}

/** Body measurements derived from a segmented point cloud. */
export interface BodyMeasurements {
  /** Extent along the body's own principal axis, metres. */
  lengthM: number;
  /** Extent perpendicular to the principal axis, metres. */
  widthM: number;
  /** Highest point above the floor, metres. */
  heightM: number;
  /** Footprint area occupied by the body, m^2. */
  dorsalAreaM2: number;
  /**
   * Volume between the floor and the animal's upper surface, m^3.
   *
   * This is a heightmap volume, so it includes the space beneath the belly and
   * between the legs. It is therefore NOT true body volume — it is a
   * repeatable proxy that correlates strongly with mass, and the coefficient
   * relating the two is fitted per species and farm rather than assumed.
   */
  heightmapVolumeM3: number;
  /** Number of cloud points the measurement rests on. */
  pointCount: number;
  /** Occupied cells over the body's bounding footprint; low means gappy data. */
  fillRatio: number;
}

/**
 * Measure the body from its segmented point cloud.
 *
 * Rasterises to a fixed metric grid rather than working point-by-point, so the
 * result does not depend on the sensor's point density varying with distance.
 */
export function measureBody(
  body: readonly GroundPoint[],
  options: { cellSizeM?: number } = {},
): BodyMeasurements | null {
  if (body.length < 50) return null;
  const cell = options.cellSizeM ?? 0.02;

  // Principal axis of the footprint, via the 2x2 covariance of (along, across).
  let mAlong = 0;
  let mAcross = 0;
  for (const p of body) {
    mAlong += p.along;
    mAcross += p.across;
  }
  mAlong /= body.length;
  mAcross /= body.length;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of body) {
    const dx = p.along - mAlong;
    const dy = p.across - mAcross;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  // Closed-form principal direction of a symmetric 2x2 matrix.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  let maxHeight = 0;

  const rotated: Array<{ u: number; v: number; h: number }> = [];
  for (const p of body) {
    const dx = p.along - mAlong;
    const dy = p.across - mAcross;
    const u = dx * cosT + dy * sinT;
    const v = -dx * sinT + dy * cosT;
    rotated.push({ u, v, h: p.height });
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    if (p.height > maxHeight) maxHeight = p.height;
  }

  // Rasterise: keep the maximum height per cell, which is the upper surface.
  const cols = Math.max(1, Math.ceil((maxU - minU) / cell));
  const rows = Math.max(1, Math.ceil((maxV - minV) / cell));
  const heights = new Float64Array(cols * rows);
  const occupied = new Uint8Array(cols * rows);

  for (const p of rotated) {
    const col = Math.min(cols - 1, Math.max(0, Math.floor((p.u - minU) / cell)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((p.v - minV) / cell)));
    const index = row * cols + col;
    if (p.h > heights[index]!) heights[index] = p.h;
    occupied[index] = 1;
  }

  let occupiedCells = 0;
  let volume = 0;
  const cellArea = cell * cell;
  for (let i = 0; i < heights.length; i++) {
    if (!occupied[i]) continue;
    occupiedCells++;
    volume += heights[i]! * cellArea;
  }

  return {
    lengthM: maxU - minU,
    widthM: maxV - minV,
    heightM: maxHeight,
    dorsalAreaM2: occupiedCells * cellArea,
    heightmapVolumeM3: volume,
    pointCount: body.length,
    fillRatio: occupiedCells / (cols * rows),
  };
}
