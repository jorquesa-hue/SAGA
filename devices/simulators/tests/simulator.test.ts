import { describe, expect, it } from "vitest";
import { chunk, generateHerd, generateWeightBatch } from "../src/index.js";

describe("device simulator", () => {
  it("generates a deterministic herd for a given seed", () => {
    const a = generateHerd(10, { seed: 1 });
    const b = generateHerd(10, { seed: 1 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
    expect(new Set(a.map((x) => x.rfid)).size).toBe(10);
    expect(a[0]!.rfid).toMatch(/^982000000\d{6}$/);
  });

  it("produces one observation per animal with stable replayable ids", () => {
    const herd = generateHerd(5, { seed: 2 });
    const first = generateWeightBatch(herd, {
      gatewayId: "gw-1",
      sessionId: "s-1",
      capturedAt: "2026-07-01T09:00:00.000Z",
      round: 0,
    });
    const replay = generateWeightBatch(herd, {
      gatewayId: "gw-1",
      sessionId: "s-1",
      capturedAt: "2026-07-01T09:00:00.000Z",
      round: 0,
    });
    expect(first.map((o) => o.observationId)).toEqual(replay.map((o) => o.observationId));
    expect(first[0]!.observationId).toBe(`gw-1:s-1:${herd[0]!.rfid}:r0`);
    expect(first.every((o) => o.value > 0 && o.unit === "kg")).toBe(true);
  });

  it("applies growth across rounds", () => {
    const herd = generateHerd(3, { seed: 3 });
    const day0 = generateWeightBatch(herd, {
      gatewayId: "g",
      sessionId: "s",
      capturedAt: "2026-06-01T00:00:00.000Z",
      growthDays: 0,
      round: 0,
      noiseKg: 0,
    });
    const day60 = generateWeightBatch(herd, {
      gatewayId: "g",
      sessionId: "s",
      capturedAt: "2026-08-01T00:00:00.000Z",
      growthDays: 60,
      round: 1,
      noiseKg: 0,
    });
    expect(day60[0]!.value).toBeGreaterThan(day0[0]!.value);
  });

  it("chunks batches for paginated flushing", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
