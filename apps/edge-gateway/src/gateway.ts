import { Outbox, SyncEngine, type LocalStore, type SyncReport, type SyncTransport } from "@jk/offline-sync";

export interface DeviceReading {
  /** RFID that links the reading to an animal server-side. */
  rfid: string;
  weightKg: number;
  /** Stable per-reading id (device sequence); also the idempotency key. */
  observationId?: string;
  capturedAt?: string;
}

export interface GatewayStatus {
  gatewayId: string;
  buffered: number; // pending upstream delivery
  delivered: number; // acknowledged by the platform
  parked: number; // rejected, awaiting human review
}

/**
 * The edge gateway's testable core (§34). Readings from LAN devices are
 * buffered durably the instant they arrive — the upstream link is never on the
 * ingest critical path — then flushed in idempotent batches with the
 * offline-sync engine's never-lose guarantees. The HTTP server in main.ts is a
 * thin shell over this class.
 */
export class EdgeGateway {
  private readonly outbox: Outbox;
  private readonly engine: SyncEngine;
  private readonly gatewayId: string;

  constructor(options: { store: LocalStore; transport: SyncTransport; gatewayId: string; batchSize?: number }) {
    this.gatewayId = options.gatewayId;
    this.outbox = new Outbox({ store: options.store });
    this.engine = new SyncEngine({ store: options.store, transport: options.transport, batchSize: options.batchSize });
  }

  /** Buffer a single device reading. Returns immediately (offline-safe). */
  async ingest(reading: DeviceReading): Promise<{ id: string }> {
    const record = await this.outbox.capture({
      id: reading.observationId,
      kind: "observation",
      operation: "weight",
      payload: {
        gatewayId: this.gatewayId,
        measurementType: "weight",
        unit: "kg",
        value: reading.weightKg,
        rfid: reading.rfid,
        capturedAt: reading.capturedAt ?? new Date().toISOString(),
      },
    });
    return { id: record.id };
  }

  /** Buffer a batch of readings (a scale/RFID reader flush). */
  async ingestBatch(readings: DeviceReading[]): Promise<{ ids: string[] }> {
    const ids: string[] = [];
    for (const r of readings) ids.push((await this.ingest(r)).id);
    return { ids };
  }

  /** Push buffered readings upstream. Safe to call on a timer or on reconnect. */
  async flush(): Promise<SyncReport> {
    return this.engine.syncAll();
  }

  async status(store: LocalStore): Promise<GatewayStatus> {
    return {
      gatewayId: this.gatewayId,
      buffered: await store.countByStatus("pending"),
      delivered: await store.countByStatus("synced"),
      parked: await store.countByStatus("rejected"),
    };
  }
}
