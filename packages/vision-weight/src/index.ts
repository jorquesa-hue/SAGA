/**
 * @jk/vision-weight — the camera weighing kernel.
 *
 * Pure, deterministic functions with no I/O, no database, no clock and no
 * randomness, so the identical code runs in the API, on an edge gateway in a
 * corral with no connectivity, and in tests. Everything stateful — cameras,
 * calibrations, observations, events — lives in the herd-operations context;
 * this package only does maths.
 *
 * Two independent problems are solved here:
 *
 *  1. HOW MUCH does the animal weigh? Recover metric scale from a calibrated
 *     plane (`homography`, `geometry`), correcting the parallax that otherwise
 *     inflates every measurement by ~48% at a typical mount.
 *
 *  2. WHICH animal is it? Score the known roster directly rather than decoding
 *     the ear tag (`identity`), fuse that with the weight, the lot roster and
 *     any RFID read, and route anything still ambiguous to human review rather
 *     than writing a wrong record.
 */

export * from "./matrix.js";
export * from "./homography.js";
export * from "./geometry.js";
export * from "./identity/ctc.js";
export * from "./identity/roster.js";
export * from "./identity/posterior.js";
