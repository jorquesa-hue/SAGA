import { describe, expect, it } from "vitest";
import {
  DEFAULT_GATE,
  deproject,
  fitGroundPlaneRansac,
  fitPlaneLeastSquares,
  groundFrameFromPlane,
  measureBody,
  segmentAnimal,
  signedDistance,
  type CameraIntrinsics,
  type DepthFrame,
} from "../src/depth.js";
import {
  SPECIES_PRIORS,
  estimateWeight,
  fuseEstimates,
  runModels,
  type ModelEstimate,
} from "../src/weight-model.js";

const INTRINSICS: CameraIntrinsics = {
  fx: 600,
  fy: 600,
  cx: 320,
  cy: 240,
  width: 640,
  height: 480,
};

const FLOOR_DEPTH_M = 4.0;

/**
 * Render a synthetic top-down depth frame: a flat floor with a rectangular
 * slab standing on it. A downward depth camera sees only the slab's upper
 * surface, which is exactly what the measurement code must cope with.
 */
function renderScene(options: {
  bodyHeightM: number;
  halfAlongM: number;
  halfAcrossM: number;
  centreAcrossM?: number;
  /**
   * Number of bands across the body that return no depth at all. Real depth
   * dropout is regional, not speckled: wet or black hide absorbs the IR
   * pattern and a whole patch comes back empty.
   */
  dropoutBands?: number;
}): DepthFrame {
  const {
    bodyHeightM,
    halfAlongM,
    halfAcrossM,
    centreAcrossM = 0,
    dropoutBands = 0,
  } = options;
  const topDepth = FLOOR_DEPTH_M - bodyHeightM;
  const depths = new Float32Array(INTRINSICS.width * INTRINSICS.height);

  for (let v = 0; v < INTRINSICS.height; v++) {
    for (let u = 0; u < INTRINSICS.width; u++) {
      const rayX = (u - INTRINSICS.cx) / INTRINSICS.fx;
      const rayY = (v - INTRINSICS.cy) / INTRINSICS.fy;
      // Where the ray would pierce the slab's top plane.
      const x = rayX * topDepth;
      const y = rayY * topDepth;
      // Camera x maps to "across", camera y maps to "along" in this scene.
      const onBody =
        Math.abs(x - centreAcrossM) <= halfAcrossM && Math.abs(y) <= halfAlongM;

      let depth = FLOOR_DEPTH_M;
      if (onBody) {
        // Blank out alternating bands along the body, each ~8 cm wide, which
        // is what an IR-absorbing patch of hide actually looks like.
        const bandIndex = Math.floor((y + halfAlongM) / 0.08);
        const dropped = dropoutBands > 0 && bandIndex % 2 === 0;
        depth = dropped ? 0 : topDepth;
      }
      depths[v * INTRINSICS.width + u] = depth;
    }
  }
  return { depths, width: INTRINSICS.width, height: INTRINSICS.height };
}

describe("deprojection and ground-plane recovery", () => {
  it("deprojects depth into a metric cloud", () => {
    const frame = renderScene({ bodyHeightM: 1.2, halfAlongM: 0.8, halfAcrossM: 0.25 });
    const points = deproject(frame, INTRINSICS, { stride: 4 });
    expect(points.length).toBeGreaterThan(1000);
    // The principal point looks straight down at the slab's top surface.
    const centre = points.find((p) => Math.abs(p.x) < 0.01 && Math.abs(p.y) < 0.01);
    expect(centre?.z).toBeCloseTo(FLOOR_DEPTH_M - 1.2, 6);
  });

  it("recovers the floor plane and measures height above it", () => {
    const frame = renderScene({ bodyHeightM: 1.2, halfAlongM: 0.8, halfAcrossM: 0.25 });
    const points = deproject(frame, INTRINSICS, { stride: 4 });
    const fit = fitGroundPlaneRansac(points, { seed: 7 });

    expect(fit).not.toBeNull();
    // The floor dominates the frame, so it must be the consensus plane.
    expect(fit!.inlierFraction).toBeGreaterThan(0.6);

    // A point known to be on the floor has zero height; the slab top has 1.2 m.
    const onFloor = { x: 1.5, y: 1.5, z: FLOOR_DEPTH_M };
    const onBack = { x: 0, y: 0, z: FLOOR_DEPTH_M - 1.2 };
    expect(Math.abs(signedDistance(fit!.plane, onFloor))).toBeLessThan(0.01);
    expect(signedDistance(fit!.plane, onBack)).toBeCloseTo(1.2, 2);
  });

  it("fits a plane exactly by least squares when the data is clean", () => {
    const plane = fitPlaneLeastSquares([
      { x: 0, y: 0, z: 4 },
      { x: 1, y: 0, z: 4 },
      { x: 0, y: 1, z: 4 },
      { x: 1, y: 1, z: 4 },
    ]);
    expect(plane).not.toBeNull();
    expect(Math.abs(plane!.normal.z)).toBeCloseTo(1, 9);
    expect(Math.abs(signedDistance(plane!, { x: 5, y: -3, z: 4 }))).toBeLessThan(1e-9);
  });

  it("is deterministic: the same seed yields the same plane", () => {
    const frame = renderScene({ bodyHeightM: 1.0, halfAlongM: 0.7, halfAcrossM: 0.25 });
    const points = deproject(frame, INTRINSICS, { stride: 6 });
    const a = fitGroundPlaneRansac(points, { seed: 42 });
    const b = fitGroundPlaneRansac(points, { seed: 42 });
    // These numbers become immutable domain events; an auditor must be able to
    // re-derive them exactly.
    expect(a!.plane.offset).toBe(b!.plane.offset);
    expect(a!.plane.normal.z).toBe(b!.plane.normal.z);
  });
});

describe("body measurement", () => {
  function measureScene(options: Parameters<typeof renderScene>[0]) {
    const frame = renderScene(options);
    const points = deproject(frame, INTRINSICS, { stride: 2 });
    const fit = fitGroundPlaneRansac(points, { seed: 7 })!;
    const groundFrame = groundFrameFromPlane(fit.plane);
    const segmented = segmentAnimal(points, groundFrame, DEFAULT_GATE);
    return { ...segmented, measurements: measureBody(segmented.body) };
  }

  it("recovers known body dimensions from the point cloud", () => {
    // A 1.6 m x 0.5 m slab standing 1.2 m tall.
    const { measurements } = measureScene({
      bodyHeightM: 1.2,
      halfAlongM: 0.8,
      halfAcrossM: 0.25,
    });

    expect(measurements).not.toBeNull();
    const m = measurements!;
    expect(m.lengthM).toBeCloseTo(1.6, 1);
    expect(m.widthM).toBeCloseTo(0.5, 1);
    expect(m.heightM).toBeCloseTo(1.2, 2);
    // Footprint 1.6 x 0.5 = 0.8 m^2.
    expect(m.dorsalAreaM2).toBeGreaterThan(0.72);
    expect(m.dorsalAreaM2).toBeLessThan(0.88);
    // Heightmap volume = footprint x height = 0.96 m^3.
    expect(m.heightmapVolumeM3).toBeGreaterThan(0.86);
    expect(m.heightmapVolumeM3).toBeLessThan(1.06);
  });

  it("excludes the floor and keeps only the animal", () => {
    const { body } = measureScene({
      bodyHeightM: 1.2,
      halfAlongM: 0.8,
      halfAcrossM: 0.25,
    });
    // Every retained point must be above the gate's floor threshold.
    expect(body.length).toBeGreaterThan(1000);
    expect(Math.min(...body.map((p) => p.height))).toBeGreaterThanOrEqual(
      DEFAULT_GATE.minHeightM,
    );
  });

  it("flags a body that runs off the edge of the measurement gate", () => {
    // An animal wider than the gate is measured short in one dimension; that
    // must be visible rather than silently producing a light weight.
    const { truncated } = measureScene({
      bodyHeightM: 1.2,
      halfAlongM: 0.8,
      halfAcrossM: 0.75,
    });
    expect(truncated).toBe(true);
  });

  it("reports a low fill ratio when patches of hide return no depth", () => {
    const dense = measureScene({
      bodyHeightM: 1.2,
      halfAlongM: 0.8,
      halfAcrossM: 0.25,
    });
    const gappy = measureScene({
      bodyHeightM: 1.2,
      halfAlongM: 0.8,
      halfAcrossM: 0.25,
      dropoutBands: 1,
    });

    expect(gappy.measurements!.fillRatio).toBeLessThan(dense.measurements!.fillRatio);
    // The missing bands cost real volume, so the estimator must not treat the
    // reading as trustworthy.
    expect(gappy.measurements!.heightmapVolumeM3).toBeLessThan(
      dense.measurements!.heightmapVolumeM3,
    );
    const estimate = estimateWeight(gappy.measurements!, "BOVINE")!;
    expect(estimate.flags).toContain("vision_sparse_cloud");
  });

  it("refuses to measure from too few points", () => {
    expect(measureBody([{ along: 0, across: 0, height: 1 }])).toBeNull();
  });
});

describe("weight models", () => {
  const body = {
    lengthM: 1.6,
    widthM: 0.5,
    heightM: 1.2,
    dorsalAreaM2: 0.8,
    heightmapVolumeM3: 0.96,
    pointCount: 8000,
    fillRatio: 0.95,
  };

  it("produces a plausible weight for a large steer", () => {
    const estimate = estimateWeight(body, "BOVINE");
    expect(estimate).not.toBeNull();
    // Sanity band, not a precision claim: these are unfitted priors.
    expect(estimate!.weightKg).toBeGreaterThan(300);
    expect(estimate!.weightKg).toBeLessThan(700);
    expect(estimate!.interval95[0]).toBeLessThan(estimate!.weightKg);
    expect(estimate!.interval95[1]).toBeGreaterThan(estimate!.weightKg);
  });

  it("admits that unfitted species priors carry bias", () => {
    const estimate = estimateWeight(body, "BOVINE")!;
    // The flag is the honest part: a farm has not calibrated yet, and the
    // interval must say so rather than a footnote saying so.
    expect(estimate.flags).toContain("vision_uncalibrated_species_prior");
    expect(SPECIES_PRIORS.BOVINE.grade).toBe("provisional");
  });

  it("widens the interval for a truncated body rather than reporting confidently", () => {
    const clean = estimateWeight(body, "BOVINE")!;
    const truncated = estimateWeight(body, "BOVINE", { truncated: true })!;
    expect(truncated.sigmaKg).toBeGreaterThan(clean.sigmaKg);
    expect(truncated.flags).toContain("vision_body_truncated");
  });

  it("abstains from the volumetric model when the cloud is too sparse", () => {
    const sparse = { ...body, fillRatio: 0.3 };
    const models = runModels(sparse, SPECIES_PRIORS.BOVINE);
    const volumetric = models.find((m) => m.model === "volumetric")!;
    // A sparse cloud under-integrates volume and would silently under-weigh.
    expect(volumetric.usable).toBe(false);

    const estimate = estimateWeight(sparse, "BOVINE")!;
    expect(estimate.flags).toContain("vision_model_abstained");
    expect(estimate.flags).toContain("vision_sparse_cloud");
  });

  it("widens the interval when models contradict each other", () => {
    const agreeing: ModelEstimate[] = [
      { model: "volumetric", weightKg: 400, sigmaKg: 20, usable: true },
      { model: "area", weightKg: 405, sigmaKg: 20, usable: true },
    ];
    const disagreeing: ModelEstimate[] = [
      { model: "volumetric", weightKg: 400, sigmaKg: 20, usable: true },
      { model: "area", weightKg: 560, sigmaKg: 20, usable: true },
    ];

    const a = fuseEstimates(agreeing)!;
    const b = fuseEstimates(disagreeing)!;
    expect(a.birgeRatio).toBeCloseTo(1, 5);
    expect(b.birgeRatio).toBeGreaterThan(1.5);
    // Disagreement must cost confidence, not be averaged away.
    expect(b.sigmaKg).toBeGreaterThan(a.sigmaKg * 2);
    expect(b.flags).toContain("vision_model_disagreement");
  });

  it("returns nothing when no model can run", () => {
    expect(
      fuseEstimates([
        { model: "volumetric", weightKg: Number.NaN, sigmaKg: 1, usable: true },
      ]),
    ).toBeNull();
  });
});
