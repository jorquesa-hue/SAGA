import { type TenantContext, type Uuid, newUuid } from "@jk/domain-kernel";
import { WeighingService } from "@jk/herd-operations";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chunk, generateHerd, generateWeightBatch, type SimulatedAnimal } from "../../src/index.js";

/**
 * Phase 1 exit criterion (Volume XII): "end-to-end 500-animal simulated
 * handling session with disconnect/replay". Also §19 acceptance: a session of
 * 500 animals remains usable with intermittent connectivity; replayed batches
 * SHALL NOT create duplicate weights; closing produces counts for expected,
 * processed, accepted, flagged, and missing animals.
 */

const available = databaseAvailable();
const HERD_SIZE = 500;

async function registerHerd(
  db: TestDatabase,
  tenantId: Uuid,
  farmId: Uuid,
  herd: readonly SimulatedAnimal[],
): Promise<void> {
  // Bulk insert animals + active RFID identifiers directly (owner pool).
  const animalValues: string[] = [];
  const animalParams: unknown[] = [];
  const idValues: string[] = [];
  const idParams: unknown[] = [];
  herd.forEach((a, i) => {
    const animalId = newUuid();
    animalParams.push(animalId, tenantId, farmId, a.visualId);
    animalValues.push(
      `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, 'female', 0)`,
    );
    idParams.push(newUuid(), tenantId, animalId, a.rfid);
    idValues.push(
      `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, 'rfid', $${i * 4 + 4}, now())`,
    );
  });
  await db.adminPool.query(
    `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, version) VALUES ${animalValues.join(",")}`,
    animalParams,
  );
  await db.adminPool.query(
    `INSERT INTO animal_identifier (id, tenant_id, animal_id, identifier_type, identifier_value, valid_from)
     VALUES ${idValues.join(",")}`,
    idParams,
  );
}

describe.skipIf(!available)("500-animal handling session with disconnect/replay", () => {
  let db: TestDatabase;
  let weighing: WeighingService;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;
  let herd: SimulatedAnimal[];

  beforeAll(async () => {
    db = await createTestDatabase("jk_500");
    const identity = makeIdentityService(db);
    weighing = new WeighingService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(identity, "Fazenda 500", "owner@example.com");
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Curral Central", areaHa: 400 });
    farmId = farm.id;
    herd = generateHerd(HERD_SIZE, { seed: 500 });
    await registerHerd(db, tenantId, farmId, herd);
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("captures 500 weights across intermittent flushes, replays safely, and reconciles", async () => {
    const session = await weighing.startSession(owner, {
      farmId,
      purpose: "weighing",
      deviceId: "gw-curral",
      expectedCount: HERD_SIZE,
    });

    const batch = generateWeightBatch(herd, {
      gatewayId: "gw-curral",
      sessionId: session.id,
      capturedAt: new Date().toISOString(),
      round: 0,
      seed: 500,
    }).map((o) => ({ ...o, handlingSessionId: session.id }));

    // Store-and-forward: the gateway flushes in pages. Simulate a disconnect
    // after the first few pages, then a full replay of the entire batch once
    // connectivity returns (at-least-once delivery, §31.2).
    const pages = chunk(batch, 100);
    let acceptedFirstPass = 0;
    for (const page of pages.slice(0, 3)) {
      const results = await weighing.ingestBatch(owner, page);
      acceptedFirstPass += results.filter((r) => r.status === "accepted").length;
    }
    expect(acceptedFirstPass).toBe(300);

    // Reconnect: replay ALL pages (including the 300 already sent).
    let acceptedReplay = 0;
    let duplicateReplay = 0;
    for (const page of pages) {
      const results = await weighing.ingestBatch(owner, page);
      acceptedReplay += results.filter((r) => r.status === "accepted").length;
      duplicateReplay += results.filter((r) => r.status === "duplicate").length;
    }
    // The replay accepts only the 200 not-yet-sent; the 300 resent are dups.
    expect(acceptedReplay).toBe(200);
    expect(duplicateReplay).toBe(300);

    // Exactly one weight per animal — no duplicates created by replay.
    const weightCount = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM animal_weight WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(Number(weightCount.rows[0]!.n)).toBe(HERD_SIZE);

    const distinctAnimals = await db.adminPool.query<{ n: string }>(
      `SELECT count(DISTINCT animal_id)::text AS n FROM animal_weight WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(Number(distinctAnimals.rows[0]!.n)).toBe(HERD_SIZE);

    // One accepted device_observation per animal; replayed ids deduped.
    const acceptedObs = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM device_observation
       WHERE tenant_id = $1 AND resolution_status = 'accepted'`,
      [tenantId],
    );
    expect(Number(acceptedObs.rows[0]!.n)).toBe(HERD_SIZE);

    // Closing the session reconciles counts.
    const closed = await weighing.closeSession(owner, session.id);
    expect(closed.status).toBe("closed");
    expect(closed.summary?.expected).toBe(HERD_SIZE);
    expect(closed.summary?.accepted).toBe(HERD_SIZE);
    expect(closed.summary?.pendingResolution).toBe(0);
  }, 120_000);
});

describe.skipIf(available)("500-animal session (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
