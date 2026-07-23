import { describe, expect, it } from "vitest";
import {
  InMemoryLocalStore,
  Outbox,
  SyncEngine,
  type DeliveryOutcome,
  type OutboxRecord,
  type SyncTransport,
} from "../src/index.js";

/** A controllable transport that records what it was asked to deliver. */
class ScriptedTransport implements SyncTransport {
  rounds: OutboxRecord[][] = [];
  constructor(private readonly reply: (records: OutboxRecord[]) => DeliveryOutcome[] | Error) {}
  async deliver(records: OutboxRecord[]): Promise<DeliveryOutcome[]> {
    this.rounds.push(records.map((r) => ({ ...r })));
    const r = this.reply(records);
    if (r instanceof Error) throw r;
    return r;
  }
  get delivered(): number {
    return this.rounds.reduce((n, r) => n + r.length, 0);
  }
}

const acceptAll = (records: OutboxRecord[]): DeliveryOutcome[] =>
  records.map((r) => ({ id: r.id, outcome: "accepted", serverId: `srv-${r.id}` }));

function fixedClock(startMs = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms) => (t += ms) };
}

let seq = 0;
const idGen = () => `r-${(seq += 1).toString().padStart(4, "0")}`;

describe("Outbox capture", () => {
  it("captures offline without touching the network; nothing is lost", async () => {
    const store = new InMemoryLocalStore();
    const outbox = new Outbox({ store, newId: idGen });
    for (let i = 0; i < 5; i++) await outbox.capture({ kind: "observation", operation: "weight", payload: { kg: 300 + i } });
    expect(await outbox.pendingCount()).toBe(5);
  });

  it("is idempotent for a repeated client id", async () => {
    const store = new InMemoryLocalStore();
    const outbox = new Outbox({ store });
    const a = await outbox.capture({ id: "same", kind: "observation", operation: "weight", payload: { kg: 300 } });
    const b = await outbox.capture({ id: "same", kind: "observation", operation: "weight", payload: { kg: 999 } });
    expect(b.id).toBe(a.id);
    expect(b.payload.kg).toBe(300); // never regressed
    expect(await outbox.pendingCount()).toBe(1);
  });
});

describe("SyncEngine", () => {
  it("flushes pending records and marks them synced with server ids", async () => {
    const store = new InMemoryLocalStore();
    const outbox = new Outbox({ store, newId: idGen });
    const rec = await outbox.capture({ kind: "observation", operation: "weight", payload: { kg: 320 } });
    const engine = new SyncEngine({ store, transport: new ScriptedTransport(acceptAll) });

    const report = await engine.sync();
    expect(report.accepted).toBe(1);
    expect(await store.countByStatus("pending")).toBe(0);
    expect((await store.getRecord(rec.id))?.status).toBe("synced");
    expect((await store.getRecord(rec.id))?.serverId).toBe(`srv-${rec.id}`);
  });

  it("applies partial success independently (accept / retry / reject)", async () => {
    const store = new InMemoryLocalStore();
    const clock = fixedClock();
    const outbox = new Outbox({ store, now: clock.now });
    const a = await outbox.capture({ id: "A", kind: "observation", operation: "w", payload: {} });
    const b = await outbox.capture({ id: "B", kind: "observation", operation: "w", payload: {} });
    const c = await outbox.capture({ id: "C", kind: "observation", operation: "w", payload: {} });
    const engine = new SyncEngine({
      store,
      now: clock.now,
      transport: new ScriptedTransport(() => [
        { id: "A", outcome: "accepted", serverId: "s-A" },
        { id: "B", outcome: "retryable", error: "server busy" },
        { id: "C", outcome: "rejected", error: "invalid animal" },
      ]),
    });

    const report = await engine.sync();
    expect(report).toMatchObject({ attempted: 3, accepted: 1, retryable: 1, rejected: 1 });
    expect((await store.getRecord("A"))?.status).toBe("synced");
    expect((await store.getRecord("B"))?.status).toBe("pending");
    expect((await store.getRecord("C"))?.status).toBe("rejected");
    // Rejected is parked for review, NOT deleted (invariant #4).
    expect(await store.countByStatus("rejected")).toBe(1);
    void [a, b, c];
  });

  it("loses nothing when the transport throws mid-sync", async () => {
    const store = new InMemoryLocalStore();
    const outbox = new Outbox({ store, newId: idGen });
    await outbox.capture({ kind: "observation", operation: "w", payload: {} });
    await outbox.capture({ kind: "observation", operation: "w", payload: {} });
    const engine = new SyncEngine({ store, transport: new ScriptedTransport(() => new Error("network down")) });

    const report = await engine.sync();
    expect(report.transportFailed).toBe(true);
    expect(await store.countByStatus("pending")).toBe(2); // both back to pending
    expect(await store.countByStatus("in_flight")).toBe(0);
  });

  it("respects backoff: a retryable record is not re-sent before its next-attempt time", async () => {
    const store = new InMemoryLocalStore();
    const clock = fixedClock();
    const outbox = new Outbox({ store, now: clock.now });
    await outbox.capture({ id: "X", kind: "observation", operation: "w", payload: {} });
    const transport = new ScriptedTransport(() => [{ id: "X", outcome: "retryable", error: "busy" }]);
    const engine = new SyncEngine({ store, now: clock.now, transport, backoffSeconds: () => 30 });

    await engine.sync(); // attempt 1 → retryable, next attempt in 30s
    await engine.sync(); // immediately: not due, nothing attempted
    expect(transport.delivered).toBe(1);

    clock.advance(30_000);
    await engine.sync(); // now due again
    expect(transport.delivered).toBe(2);
  });

  it("recovers records stranded in_flight by an interrupted round", async () => {
    const store = new InMemoryLocalStore();
    await store.putRecord({
      id: "stuck",
      kind: "observation",
      operation: "w",
      payload: {},
      status: "in_flight",
      attempts: 1,
      capturedAt: 1,
      nextAttemptAt: 1,
    });
    const engine = new SyncEngine({ store, transport: new ScriptedTransport(acceptAll) });
    const report = await engine.sync();
    expect(report.accepted).toBe(1);
    expect((await store.getRecord("stuck"))?.status).toBe("synced");
  });

  it("treats a missing per-record outcome as retryable, never as success", async () => {
    const store = new InMemoryLocalStore();
    const outbox = new Outbox({ store });
    await outbox.capture({ id: "M", kind: "observation", operation: "w", payload: {} });
    const engine = new SyncEngine({ store, transport: new ScriptedTransport(() => []) });
    await engine.sync();
    expect((await store.getRecord("M"))?.status).toBe("pending");
    expect((await store.getRecord("M"))?.lastError).toBe("no_outcome_returned");
  });

  it("checkpoints round-trip for read-model pull", async () => {
    const store = new InMemoryLocalStore();
    expect(await store.getCheckpoint("animals")).toBeUndefined();
    await store.setCheckpoint("animals", "cursor-42");
    expect(await store.getCheckpoint("animals")).toBe("cursor-42");
  });
});

describe("scenario #1/#2 — 500-observation disconnect and replay", () => {
  it("captures 500 offline, drains them all on reconnect, and re-sync is a no-op", async () => {
    const store = new InMemoryLocalStore();
    const outbox = new Outbox({ store, newId: idGen });
    for (let i = 0; i < 500; i++) {
      await outbox.capture({ kind: "observation", operation: "weight", payload: { seq: i, kg: 200 + (i % 300) } });
    }
    expect(await outbox.pendingCount()).toBe(500);

    // Server dedupes on id; deliver everything successfully across batches.
    const seen = new Set<string>();
    const transport = new ScriptedTransport((records) => {
      for (const r of records) {
        // A record must never be delivered twice as "new" — idempotency holds.
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      return acceptAll(records);
    });
    const engine = new SyncEngine({ store, transport, batchSize: 100 });

    const report = await engine.syncAll();
    expect(report.accepted).toBe(500);
    expect(seen.size).toBe(500);
    expect(await store.countByStatus("pending")).toBe(0);
    expect(await store.countByStatus("synced")).toBe(500);

    // Reconnecting again delivers nothing (all synced) — no duplicates.
    const again = await engine.syncAll();
    expect(again.attempted).toBe(0);
  });

  it("survives an intermittent link: some batches fail, but every observation still lands", async () => {
    const store = new InMemoryLocalStore();
    const outbox = new Outbox({ store, newId: idGen });
    for (let i = 0; i < 250; i++) await outbox.capture({ kind: "observation", operation: "weight", payload: { seq: i } });

    let round = 0;
    const transport = new ScriptedTransport((records) => {
      round += 1;
      if (round % 2 === 0) return new Error("flaky link"); // every other round drops
      return acceptAll(records);
    });
    const engine = new SyncEngine({ store, transport, batchSize: 50 });

    // Drive until drained (syncAll stops on a failed round, so loop).
    for (let i = 0; i < 50 && (await store.countByStatus("pending")) > 0; i++) await engine.syncAll();

    expect(await store.countByStatus("synced")).toBe(250);
    expect(await store.countByStatus("pending")).toBe(0);
    expect(await store.countByStatus("rejected")).toBe(0);
  });
});
