import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { SyncEngine, type OutboxRecord } from "@jk/offline-sync";
import { describe, expect, it } from "vitest";
import { AsyncKvLocalStore, MemoryAsyncKv } from "../src/kv-store.js";
import { HttpSyncTransport } from "@jk/sync-http";
import { CaptureController } from "../src/capture-controller.js";

/** A client whose batch endpoint returns a scripted per-observation result. */
function batchClient(reply: (observations: Record<string, unknown>[]) => unknown): {
  client: JkPlatformClient;
  calls: Record<string, unknown>[][];
} {
  const calls: Record<string, unknown>[][] = [];
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as {
      observations: Record<string, unknown>[];
    };
    calls.push(body.observations);
    return {
      status: 207,
      headers: { get: () => "c" },
      text: async () => JSON.stringify(reply(body.observations)),
    };
  };
  return {
    client: new JkPlatformClient({
      baseUrl: "http://api.test",
      tenantId: "t",
      auth: { mode: "none" },
      fetch,
    }),
    calls,
  };
}

describe("AsyncKvLocalStore", () => {
  it("persists records and drives the sync engine like the in-memory store", async () => {
    const store = new AsyncKvLocalStore(new MemoryAsyncKv());
    const rec: OutboxRecord = {
      id: "k1",
      kind: "observation",
      operation: "weight",
      payload: { value: 300 },
      status: "pending",
      attempts: 0,
      capturedAt: 1,
      nextAttemptAt: 1,
    };
    await store.putRecord(rec);
    expect(await store.countByStatus("pending")).toBe(1);

    const { client } = batchClient((obs) => ({
      results: obs.map((o) => ({
        observationId: o.observationId,
        serverObservationId: "s1",
        status: "accepted",
      })),
    }));
    const engine = new SyncEngine({ store, transport: new HttpSyncTransport(client) });
    const report = await engine.sync();
    expect(report.accepted).toBe(1);
    expect((await store.getRecord("k1"))?.status).toBe("synced");
  });

  it("round-trips a checkpoint", async () => {
    const store = new AsyncKvLocalStore(new MemoryAsyncKv());
    await store.setCheckpoint("animals", "cur-1");
    expect(await store.getCheckpoint("animals")).toBe("cur-1");
  });
});

describe("HttpSyncTransport outcome mapping", () => {
  it("maps accepted/duplicate/pending_resolution → accepted; rejected → rejected; else retryable", async () => {
    const records: OutboxRecord[] = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      kind: "observation",
      operation: "weight",
      payload: { value: 1 },
      status: "in_flight",
      attempts: 0,
      capturedAt: 1,
      nextAttemptAt: 1,
    }));
    const { client } = batchClient(() => ({
      results: [
        { observationId: "a", serverObservationId: "sa", status: "accepted" },
        { observationId: "b", serverObservationId: "sb", status: "duplicate" },
        { observationId: "c", serverObservationId: "sc", status: "pending_resolution" },
        {
          observationId: "d",
          serverObservationId: null,
          status: "rejected_validation",
          reason: "unknown rfid",
        },
        { observationId: "e", serverObservationId: null, status: "retryable_error" },
      ],
    }));
    const outcomes = await new HttpSyncTransport(client).deliver(records);
    expect(outcomes.map((o) => o.outcome)).toEqual([
      "accepted",
      "accepted",
      "accepted",
      "rejected",
      "retryable",
    ]);
    expect(outcomes[0]!.serverId).toBe("sa");
  });

  it("treats a missing server result as retryable (never assumes delivery)", async () => {
    const records: OutboxRecord[] = [
      {
        id: "x",
        kind: "observation",
        operation: "weight",
        payload: {},
        status: "in_flight",
        attempts: 0,
        capturedAt: 1,
        nextAttemptAt: 1,
      },
    ];
    const { client } = batchClient(() => ({ results: [] }));
    const outcomes = await new HttpSyncTransport(client).deliver(records);
    expect(outcomes[0]).toMatchObject({
      outcome: "retryable",
      error: "no_result_returned",
    });
  });
});

describe("CaptureController", () => {
  it("captures offline and syncs on reconnect; the batch carries the idempotency id", async () => {
    const store = new AsyncKvLocalStore(new MemoryAsyncKv());
    const { client, calls } = batchClient((obs) => ({
      results: obs.map((o) => ({
        observationId: o.observationId,
        serverObservationId: `srv-${o.observationId}`,
        status: "accepted",
      })),
    }));
    const controller = new CaptureController(store, new HttpSyncTransport(client));

    // Offline capture — three weights, network never touched.
    const a = await controller.captureWeight({
      rfid: "982A",
      weightKg: 305,
      observationId: "o1",
      capturedAt: "2026-07-01T10:00:00Z",
    });
    await controller.captureWeight({
      rfid: "982B",
      weightKg: 288,
      observationId: "o2",
      capturedAt: "2026-07-01T10:01:00Z",
    });
    await controller.captureWeight({
      rfid: "982C",
      weightKg: 331,
      observationId: "o3",
      capturedAt: "2026-07-01T10:02:00Z",
    });
    expect(a.id).toBe("o1");
    expect(await controller.status()).toMatchObject({ pending: 3, synced: 0 });

    const report = await controller.sync();
    expect(report.accepted).toBe(3);
    expect(await controller.status()).toMatchObject({
      pending: 0,
      synced: 3,
      rejected: 0,
    });
    // The observation carried its stable id as the idempotency key.
    expect(calls[0]![0]!.observationId).toBe("o1");
    expect(calls[0]![0]!.rfid).toBe("982A");
  });

  it("parks a rejected capture for review instead of dropping it", async () => {
    const store = new AsyncKvLocalStore(new MemoryAsyncKv());
    const { client } = batchClient((obs) => ({
      results: obs.map((o) => ({
        observationId: o.observationId,
        serverObservationId: null,
        status: "rejected_validation",
        reason: "bad",
      })),
    }));
    const controller = new CaptureController(store, new HttpSyncTransport(client));
    await controller.captureWeight({
      rfid: "982X",
      weightKg: 300,
      observationId: "bad1",
    });
    await controller.sync();
    expect(await controller.status()).toMatchObject({ pending: 0, rejected: 1 });
  });
});
