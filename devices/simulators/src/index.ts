/**
 * Scale + RFID device simulator (§33, §56, ADR-006). Pure, deterministic
 * generation — no I/O — so tests and demos can drive the real observation
 * pipeline with a synthetic herd and reproducible batches, including
 * store-and-forward replay (the Phase 1 exit criterion).
 *
 * The emitted observation shape is structurally the herd-operations
 * ObservationInput; this package stays dependency-free at runtime so it can
 * feed any adapter or the API's device-observations:batch endpoint.
 */

export interface SimulatedAnimal {
  rfid: string;
  visualId: string;
  baseWeightKg: number;
  adgKgPerDay: number;
}

export interface SimulatedObservation {
  observationId: string;
  gatewayId: string;
  deviceId: string;
  capturedAt: string;
  measurementType: "weight";
  value: number;
  unit: "kg";
  rfid: string;
}

/** Deterministic LCG so a given seed always yields the same herd/readings. */
function lcg(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export interface HerdOptions {
  seed?: number;
  /** RFID numeric prefix; each animal gets prefix + zero-padded index. */
  rfidPrefix?: string;
  minBaseKg?: number;
  maxBaseKg?: number;
}

export function generateHerd(
  count: number,
  options: HerdOptions = {},
): SimulatedAnimal[] {
  const rand = lcg(options.seed ?? 42);
  const prefix = options.rfidPrefix ?? "982000000";
  const minBase = options.minBaseKg ?? 180;
  const maxBase = options.maxBaseKg ?? 320;
  const herd: SimulatedAnimal[] = [];
  for (let i = 1; i <= count; i += 1) {
    const suffix = String(i).padStart(6, "0");
    herd.push({
      rfid: `${prefix}${suffix}`,
      visualId: `SIM-${suffix}`,
      baseWeightKg: Math.round((minBase + rand() * (maxBase - minBase)) * 10) / 10,
      adgKgPerDay: Math.round((0.6 + rand() * 0.8) * 100) / 100,
    });
  }
  return herd;
}

export interface BatchOptions {
  gatewayId: string;
  sessionId: string;
  /** ISO capture time for this round. */
  capturedAt: string;
  /** Days of growth applied to base weight (for multi-round trends). */
  growthDays?: number;
  /** Reading round; part of the stable observation id so replay dedups. */
  round?: number;
  /** ±kg measurement noise. */
  noiseKg?: number;
  seed?: number;
}

/**
 * Produce one weight observation per animal. observationId is a stable,
 * deterministic function of (gateway, session, rfid, round), so re-emitting
 * the same round yields byte-identical ids — replay is idempotent downstream.
 */
export function generateWeightBatch(
  herd: readonly SimulatedAnimal[],
  options: BatchOptions,
): SimulatedObservation[] {
  const rand = lcg((options.seed ?? 7) + (options.round ?? 0) * 101);
  const growthDays = options.growthDays ?? 0;
  const noiseKg = options.noiseKg ?? 1.5;
  const round = options.round ?? 0;
  return herd.map((animal) => {
    const noise = (rand() - 0.5) * 2 * noiseKg;
    const value =
      Math.round((animal.baseWeightKg + animal.adgKgPerDay * growthDays + noise) * 10) /
      10;
    return {
      observationId: `${options.gatewayId}:${options.sessionId}:${animal.rfid}:r${round}`,
      gatewayId: options.gatewayId,
      deviceId: `${options.gatewayId}-scale-1`,
      capturedAt: options.capturedAt,
      measurementType: "weight",
      value: Math.max(value, 1),
      unit: "kg",
      rfid: animal.rfid,
    };
  });
}

/** Split a batch into chunks (simulating paginated store-and-forward flush). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
