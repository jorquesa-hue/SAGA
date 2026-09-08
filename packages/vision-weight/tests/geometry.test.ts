import { describe, expect, it } from "vitest";
import {
  applyHomography,
  estimateHomography,
  localScaleAt,
  type Correspondence,
  type Point2,
} from "../src/homography.js";
import {
  assessDrift,
  correctForHeight,
  solveDorsalHeight,
  solveTwoPlaneGeometry,
  minimumMountHeightM,
  minimumMountHeightForCoverageM,
} from "../src/geometry.js";

/**
 * A synthetic downward-looking pinhole camera. Everything in this file is
 * checked against ground truth we control, because the whole weight chain
 * inherits any error here and cubes it.
 *
 * Camera centre sits at (nadirX, nadirY, heightM) looking straight down. A
 * world point (X, Y, Z) projects to
 *   u = cx + f * (X - nadirX) / (H - Z)
 *   v = cy + f * (Y - nadirY) / (H - Z)
 */
function makeCamera(options: {
  heightM: number;
  focalPx: number;
  principal: Point2;
  nadir?: Point2;
}) {
  const nadir = options.nadir ?? { x: 0, y: 0 };
  return {
    ...options,
    nadir,
    project(world: Point2, heightM: number): Point2 {
      const depth = options.heightM - heightM;
      return {
        x: options.principal.x + (options.focalPx * (world.x - nadir.x)) / depth,
        y: options.principal.y + (options.focalPx * (world.y - nadir.y)) / depth,
      };
    },
  };
}

/** A square fiducial board of `halfSize` metres, centred at `centre`. */
function boardCorners(centre: Point2, halfSize: number): Point2[] {
  return [
    { x: centre.x - halfSize, y: centre.y - halfSize },
    { x: centre.x + halfSize, y: centre.y - halfSize },
    { x: centre.x + halfSize, y: centre.y + halfSize },
    { x: centre.x - halfSize, y: centre.y + halfSize },
  ];
}

const CAMERA = makeCamera({
  heightM: 4.0,
  focalPx: 1200,
  principal: { x: 960, y: 540 },
  nadir: { x: 0.15, y: -0.1 },
});

describe("homography estimation", () => {
  it("recovers an exact pixel-to-metre mapping on a calibrated plane", () => {
    const world = boardCorners({ x: 0, y: 0 }, 0.6);
    const correspondences: Correspondence[] = world.map((w) => ({
      pixel: CAMERA.project(w, 0),
      world: w,
    }));

    const h = estimateHomography(correspondences);
    expect(h).not.toBeNull();
    // A noiseless synthetic plane must fit to numerical precision.
    expect(h!.reprojectionRmsM).toBeLessThan(1e-9);

    // An independent point not used in the fit must also map correctly.
    const probe = { x: 0.31, y: -0.22 };
    const mapped = applyHomography(h!.matrix, CAMERA.project(probe, 0));
    expect(mapped.x).toBeCloseTo(probe.x, 6);
    expect(mapped.y).toBeCloseTo(probe.y, 6);
  });

  it("reports local scale matching the analytic ground-sample distance", () => {
    const world = boardCorners({ x: 0, y: 0 }, 0.6);
    const h = estimateHomography(
      world.map((w) => ({ pixel: CAMERA.project(w, 0), world: w })),
    )!;

    // For a nadir-pointing pinhole, metres per pixel on the ground = H / f.
    const expected = CAMERA.heightM / CAMERA.focalPx;
    const scale = localScaleAt(h.matrix, CAMERA.principal);
    expect(scale.maxMetresPerPx).toBeCloseTo(expected, 6);
    expect(scale.areaM2PerPx2).toBeCloseTo(expected * expected, 9);
    // Straight down: locally isotropic.
    expect(scale.anisotropy).toBeCloseTo(1, 6);
  });

  it("refuses to fit with fewer than four correspondences", () => {
    const world = boardCorners({ x: 0, y: 0 }, 0.5).slice(0, 3);
    expect(
      estimateHomography(world.map((w) => ({ pixel: CAMERA.project(w, 0), world: w }))),
    ).toBeNull();
  });
});

describe("two-plane geometry solve", () => {
  const REFERENCE_HEIGHT = 1.3;

  function calibrate() {
    const groundWorld = boardCorners({ x: 0, y: 0 }, 0.6);
    const ground = estimateHomography(
      groundWorld.map((w) => ({ pixel: CAMERA.project(w, 0), world: w })),
    )!;

    const elevatedWorld = boardCorners({ x: 0.05, y: 0.05 }, 0.45);
    const elevatedPixels = elevatedWorld.map((w) => CAMERA.project(w, REFERENCE_HEIGHT));
    const elevated = estimateHomography(
      elevatedWorld.map((w, i) => ({ pixel: elevatedPixels[i]!, world: w })),
    )!;

    return { ground, elevated, elevatedPixels };
  }

  it("recovers camera height and nadir with no intrinsics", () => {
    const { ground, elevated, elevatedPixels } = calibrate();
    const result = solveTwoPlaneGeometry(
      elevatedPixels,
      ground,
      elevated,
      REFERENCE_HEIGHT,
    );

    expect(result.ok).toBe(true);
    const g = result.geometry!;
    expect(g.cameraHeightM).toBeCloseTo(CAMERA.heightM, 5);
    expect(g.nadir.x).toBeCloseTo(CAMERA.nadir.x, 5);
    expect(g.nadir.y).toBeCloseTo(CAMERA.nadir.y, 5);
    // mu = H / (H - h) = 4.0 / 2.7
    expect(g.magnification).toBeCloseTo(4.0 / 2.7, 5);
    expect(g.residualM).toBeLessThan(1e-9);
  });

  it("rejects a reference board too low to separate the planes", () => {
    // A board 5 mm off the floor is photogrammetrically the floor.
    const groundWorld = boardCorners({ x: 0, y: 0 }, 0.6);
    const ground = estimateHomography(
      groundWorld.map((w) => ({ pixel: CAMERA.project(w, 0), world: w })),
    )!;
    const pixels = groundWorld.map((w) => CAMERA.project(w, 0.005));
    const elevated = estimateHomography(
      groundWorld.map((w, i) => ({ pixel: pixels[i]!, world: w })),
    )!;

    const result = solveTwoPlaneGeometry(pixels, ground, elevated, 0.005);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("planes_indistinguishable");
  });

  it("undoes the parallax magnification of an elevated point", () => {
    const { ground, elevated, elevatedPixels } = calibrate();
    const geometry = solveTwoPlaneGeometry(
      elevatedPixels,
      ground,
      elevated,
      REFERENCE_HEIGHT,
    ).geometry!;

    // A point physically at dorsal height, measured naively on the ground plane.
    const truth = { x: 0.4, y: 0.2 };
    const pixel = CAMERA.project(truth, REFERENCE_HEIGHT);
    const naive = applyHomography(ground.matrix, pixel);

    // The naive reading is inflated about the nadir...
    expect(
      Math.hypot(naive.x - geometry.nadir.x, naive.y - geometry.nadir.y),
    ).toBeGreaterThan(Math.hypot(truth.x - geometry.nadir.x, truth.y - geometry.nadir.y));

    // ...and the correction recovers the truth.
    const corrected = correctForHeight(naive, geometry, REFERENCE_HEIGHT);
    expect(corrected.x).toBeCloseTo(truth.x, 5);
    expect(corrected.y).toBeCloseTo(truth.y, 5);
  });

  it("quantifies why ignoring parallax is not survivable", () => {
    // At a 4 m mount with a 1.3 m back, lengths inflate by H/(H-h) = 1.48.
    // A dorsal-area model (area ~ L^2, weight ~ area^1.35) turns that into an
    // absurd overestimate — this test pins the magnitude so nobody is tempted
    // to treat the correction as optional.
    const linearInflation = 4.0 / (4.0 - 1.3);
    const areaInflation = linearInflation ** 2;
    const weightInflation = areaInflation ** 1.35;
    expect(linearInflation).toBeCloseTo(1.481, 3);
    expect(weightInflation).toBeGreaterThan(2.5);
  });
});

describe("dorsal height fixed point", () => {
  // Nelore-ish: back height ~ 0.55 m + 0.42 * body length.
  const PRIOR = { alphaM: 0.55, beta: 0.42 };

  it("converges to the self-consistent height and length", () => {
    const geometry = { cameraHeightM: 4.0 };
    // Ground-plane (uncorrected) length of a real 1.55 m torso at that height.
    const trueLength = 1.55;
    const trueHeight = PRIOR.alphaM + PRIOR.beta * trueLength;
    const uncorrected = trueLength / (1 - trueHeight / geometry.cameraHeightM);

    const solved = solveDorsalHeight(uncorrected, geometry, PRIOR, 12);
    expect(solved.heightM).toBeCloseTo(trueHeight, 2);
    expect(solved.correctedLengthM).toBeCloseTo(trueLength, 2);
  });

  it("refuses a mount too low for the animal, even though it converges", () => {
    // A 1.2 m mount converges to h/H = 0.97 and a correction factor of 0.03,
    // which yields a plausible-LOOKING 1.46 m torso while amplifying every
    // error thirtyfold. It must be refused, not returned.
    const solved = solveDorsalHeight(50, { cameraHeightM: 1.2 }, PRIOR, 5);
    expect(Number.isNaN(solved.heightM)).toBe(true);
    expect(solved.converged).toBe(false);
  });

  it("derives the photogrammetric mount floor from the gradient rule", () => {
    // Back height of a 1.9 m Nelore is 1.35 m; keeping it under half the
    // camera height puts the floor at ~2.7 m.
    const minimum = minimumMountHeightM(PRIOR, 1.9);
    expect(minimum).toBeCloseTo((PRIOR.alphaM + PRIOR.beta * 1.9) / 0.5, 6);
    expect(minimum).toBeGreaterThan(2.6);
    expect(minimum).toBeLessThan(2.8);

    // And a mount at exactly that floor must actually pass the solver's guard.
    const trueLength = 1.9;
    const trueHeight = PRIOR.alphaM + PRIOR.beta * trueLength;
    const geometry = { cameraHeightM: minimum * 1.01 };
    const uncorrected = trueLength / (1 - trueHeight / geometry.cameraHeightM);
    const solved = solveDorsalHeight(uncorrected, geometry, PRIOR, 25);
    expect(solved.correctedLengthM).toBeCloseTo(trueLength, 1);
  });

  it("requires a higher mount than the gradient floor once the lens must cover the animal", () => {
    // With a 60-degree lens the coverage constraint binds well above the
    // photogrammetric floor, which is why real installs sit near 4 m.
    const gradientFloor = minimumMountHeightM(PRIOR, 1.9);
    const coverage = minimumMountHeightForCoverageM(PRIOR, 1.9, 60);
    expect(coverage).toBeGreaterThan(gradientFloor);
    // Lands in the 3.5-4.5 m band that real top-down installs actually use.
    expect(coverage).toBeGreaterThan(3.4);
    expect(coverage).toBeLessThan(5.0);
  });
});

describe("drift detection", () => {
  const gate: Point2[] = [
    { x: 700, y: 300 },
    { x: 1220, y: 300 },
    { x: 1220, y: 780 },
    { x: 700, y: 780 },
  ];

  function homographyForCamera(height: number) {
    const cam = makeCamera({
      heightM: height,
      focalPx: 1200,
      principal: { x: 960, y: 540 },
      nadir: { x: 0.15, y: -0.1 },
    });
    const world = boardCorners({ x: 0, y: 0 }, 0.6);
    return estimateHomography(
      world.map((w) => ({ pixel: cam.project(w, 0), world: w })),
    )!;
  }

  it("passes an unmoved camera", () => {
    const h = homographyForCamera(4.0);
    const drift = assessDrift(h, h, gate);
    expect(drift.scaleRatio).toBeCloseTo(1, 9);
    expect(drift.exceedsTolerance).toBe(false);
  });

  it("catches a scale change from the post being knocked", () => {
    // The camera drops 8 cm: every length silently shrinks by 2%.
    const drift = assessDrift(homographyForCamera(4.0), homographyForCamera(3.92), gate);
    expect(Math.abs(drift.scaleRatio - 1)).toBeGreaterThan(0.015);
    expect(drift.exceedsTolerance).toBe(true);
  });
});
