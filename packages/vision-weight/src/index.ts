/**
 * @jk/vision-weight — the camera weighing kernel.
 *
 * Pure, deterministic functions with no I/O, no database, no clock and no
 * randomness, so the identical code runs in the API, on an edge gateway in a
 * corral with no connectivity, and in tests. Everything stateful — cameras,
 * calibrations, observations, events — lives in the herd-operations context;
 * this package only does maths.
 *
 * Two independent problems are solved here, and they stay independent because
 * they fail in unrelated ways.
 *
 * 1. HOW MUCH does the animal weigh?  (`depth`, `weight-model`)
 *    A depth sensor measures metric scale and the animal's back height
 *    directly, so the geometry stops being an inference problem: deproject to
 *    a point cloud, fit the floor, isolate the body above it, and integrate a
 *    real volume. Volume predicts mass far better than a silhouette's
 *    projected area, which is why depth-based systems reach the accuracy they
 *    do. The monocular path (`homography`, `geometry`) is kept only as the
 *    degraded tier for RGB-only installs.
 *
 * 2. WHICH animal is it?  (`identity`)
 *    Unchanged by the choice of sensor, because depth streams do not read ear
 *    tags. SAGA knows which animals could be passing, so the recogniser never
 *    has to produce the right string — only score it above its in-set rivals.
 *    That is fused with the weight, the lot roster and any RFID read, and
 *    anything still ambiguous is routed to human review rather than written as
 *    a wrong record.
 *
 * Nothing here decides that an estimate may be used commercially. That gate
 * lives with the data, in herd-operations.
 */

// Primary path: depth acquisition and the weight models it feeds.
export * from "./depth.js";
export * from "./weight-model.js";

// Identity: sensor-independent.
export * from "./identity/ctc.js";
export * from "./identity/roster.js";
export * from "./identity/posterior.js";

// Shared numerics, plus the monocular fallback tier.
export * from "./matrix.js";
export * from "./homography.js";
export * from "./geometry.js";
