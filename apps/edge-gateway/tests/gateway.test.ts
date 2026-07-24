import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeliveryOutcome, OutboxRecord, SyncTransport } from "@jk/offline-sync";
import { afterAll, describe, expect, it } from "vitest";
import { FileLocalStore } from "../src/file-store.js";
import { EdgeGateway } from "../src/gateway.js";

const dir = mkdtempSync(join(tmpdir(), "jk-edge-"));
let n = 0;
const tmpFile = () => join(dir, `outbox-${(n += 1)}.json`);

afterAll(() => {
  // temp dir is left for the OS to reclaim
});

class FakeTransport implements SyncTransport {
  constructor(private reply: (records: OutboxRecord[]) => DeliveryOutcome[] | Error) {}
  async deliver(records: OutboxRecord[]): Promise<DeliveryOutcome[]> {
    const r = this.reply(records);
    if (r instanceof Error) throw r;
    return r;
  }
  setReply(reply: (records: OutboxRecord[]) => DeliveryOutcome[] | Error): void {
    this.reply = reply;
  }
}

const acceptAll = (records: OutboxRecord[]): DeliveryOutcome[] =>
  records.map((r) => ({ id: r.id, outcome: "accepted", serverId: `s-${r.id}` }));

describe("FileLocalStore durability", () => {
  it("persists the buffer across a restart (new instance, same file)", async () => {
    const path = tmpFile();
    const a = new FileLocalStore(path);
    await a.putRecord({
      id: "d1",
      kind: "observation",
      operation: "weight",
      payload: { value: 300 },
      status: "pending",
      attempts: 0,
      capturedAt: 1,
      nextAttemptAt: 1,
    });
    // Simulate a process restart: a fresh store over the same file.
    const b = new FileLocalStore(path);
    expect(await b.countByStatus("pending")).toBe(1);
    expect((await b.getRecord("d1"))?.payload.value).toBe(300);
  });
});

describe("EdgeGateway", () => {
  it("buffers readings on ingest and delivers them on flush", async () => {
    const store = new FileLocalStore(tmpFile());
    const gateway = new EdgeGateway({
      store,
      transport: new FakeTransport(acceptAll),
      gatewayId: "edge-1",
    });

    await gateway.ingestBatch([
      {
        rfid: "982A",
        weightKg: 305,
        observationId: "o1",
        capturedAt: "2026-07-01T10:00:00Z",
      },
      {
        rfid: "982B",
        weightKg: 288,
        observationId: "o2",
        capturedAt: "2026-07-01T10:01:00Z",
      },
    ]);
    expect(await gateway.status(store)).toMatchObject({ buffered: 2, delivered: 0 });

    const report = await gateway.flush();
    expect(report.accepted).toBe(2);
    expect(await gateway.status(store)).toMatchObject({
      buffered: 0,
      delivered: 2,
      parked: 0,
    });
  });

  it("loses nothing while the upstream link is down, then drains on recovery", async () => {
    const store = new FileLocalStore(tmpFile());
    const transport = new FakeTransport(() => new Error("uplink down"));
    const gateway = new EdgeGateway({ store, transport, gatewayId: "edge-1" });

    await gateway.ingest({ rfid: "982C", weightKg: 331, observationId: "o3" });
    const failed = await gateway.flush();
    expect(failed.transportFailed).toBe(true);
    // Reading is still buffered — never lost (invariant #4).
    expect(await gateway.status(store)).toMatchObject({ buffered: 1, delivered: 0 });

    transport.setReply(acceptAll); // uplink restored
    await gateway.flush();
    expect(await gateway.status(store)).toMatchObject({ buffered: 0, delivered: 1 });
  });

  it("parks a rejected reading for review instead of dropping it", async () => {
    const store = new FileLocalStore(tmpFile());
    const transport = new FakeTransport((records) =>
      records.map((r) => ({ id: r.id, outcome: "rejected", error: "unknown rfid" })),
    );
    const gateway = new EdgeGateway({ store, transport, gatewayId: "edge-1" });
    await gateway.ingest({ rfid: "BAD", weightKg: 300, observationId: "o4" });
    await gateway.flush();
    expect(await gateway.status(store)).toMatchObject({ buffered: 0, parked: 1 });
  });
});
