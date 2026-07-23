import { Outbox, SyncEngine, type LocalStore, type SyncReport, type SyncTransport } from "@jk/offline-sync";

export interface QueueStatus {
  pending: number;
  synced: number;
  rejected: number;
}

export interface CaptureWeightInput {
  /** RFID that links the observation to an animal server-side. */
  rfid: string;
  weightKg: number;
  /** Stable client id (defaults to a generated one); also the idempotency key. */
  observationId?: string;
  capturedAt?: string;
}

/**
 * Headless capture view-model the RN screens bind to (ui/). It keeps the UI
 * dumb: capture writes durably and returns instantly (offline-safe); sync
 * flushes the outbox when connectivity is available. All the never-lose logic
 * lives in the offline-sync engine — this is just the app-facing surface.
 */
export class CaptureController {
  private readonly outbox: Outbox;
  private readonly engine: SyncEngine;

  constructor(private readonly store: LocalStore, transport: SyncTransport, options: { gatewayId?: string } = {}) {
    this.outbox = new Outbox({ store });
    this.engine = new SyncEngine({ store, transport });
    this.gatewayId = options.gatewayId ?? "mobile";
  }

  private readonly gatewayId: string;

  /** Capture a weight offline. Returns immediately; never awaits the network. */
  async captureWeight(input: CaptureWeightInput): Promise<{ id: string }> {
    const record = await this.outbox.capture({
      id: input.observationId,
      kind: "observation",
      operation: "weight",
      payload: {
        gatewayId: this.gatewayId,
        measurementType: "weight",
        unit: "kg",
        value: input.weightKg,
        rfid: input.rfid,
        capturedAt: input.capturedAt ?? isoNow(),
      },
    });
    return { id: record.id };
  }

  /** Flush the outbox (call on reconnect / a timer / a manual "sync" button). */
  async sync(): Promise<SyncReport> {
    return this.engine.syncAll();
  }

  async status(): Promise<QueueStatus> {
    return {
      pending: await this.store.countByStatus("pending"),
      synced: await this.store.countByStatus("synced"),
      rejected: await this.store.countByStatus("rejected"),
    };
  }
}

function isoNow(): string {
  // Runtime-only (device); tests pass capturedAt explicitly for determinism.
  return new Date().toISOString();
}
