import type { DeliveryOutcome, LocalStore, OutboxRecord, SyncTransport } from "./types.js";

export interface SyncReport {
  /** Records handed to the transport this round. */
  attempted: number;
  accepted: number;
  retryable: number;
  rejected: number;
  /** True when the transport threw (total failure) — records stay pending. */
  transportFailed: boolean;
}

export interface SyncEngineOptions {
  store: LocalStore;
  transport: SyncTransport;
  now?: () => number;
  /** Max records per delivery round. */
  batchSize?: number;
  /** Backoff seconds given the (1-based) attempt number. */
  backoffSeconds?: (attempt: number) => number;
}

function defaultBackoff(attempt: number): number {
  return Math.min(3600, 2 ** (attempt - 1) * 15); // 15s, 30s, 60s, … capped 1h
}

/**
 * At-least-once, idempotent sync of the local outbox to the server (§34,
 * invariants #4/#5). Guarantees:
 *  - Nothing is lost: a record leaves `pending` only when the server accepts
 *    it (→ synced) or permanently rejects it (→ rejected, parked for review).
 *  - Crash-safe: records left `in_flight` by an interrupted round are
 *    reclaimed to `pending` and re-sent (safe because delivery is idempotent).
 *  - Partial success: each record's outcome is applied independently; a
 *    missing outcome is treated as retryable, never as success.
 *  - Backoff: a retryable record is not re-sent before its next-attempt time.
 */
export class SyncEngine {
  private readonly store: LocalStore;
  private readonly transport: SyncTransport;
  private readonly now: () => number;
  private readonly batchSize: number;
  private readonly backoffSeconds: (attempt: number) => number;

  constructor(options: SyncEngineOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.now = options.now ?? (() => Date.now());
    this.batchSize = options.batchSize ?? 100;
    this.backoffSeconds = options.backoffSeconds ?? defaultBackoff;
  }

  /** Reclaim records stranded `in_flight` by an interrupted previous round. */
  private async recover(): Promise<void> {
    const stranded = await this.store.listByStatus("in_flight");
    for (const r of stranded) {
      await this.store.putRecord({ ...r, status: "pending" });
    }
  }

  /** Records that are pending and whose backoff has elapsed, oldest first. */
  private async due(now: number): Promise<OutboxRecord[]> {
    const pending = await this.store.listByStatus("pending");
    return pending.filter((r) => r.nextAttemptAt <= now).slice(0, this.batchSize);
  }

  /** Flush one due batch. Never throws for transport failures. */
  async sync(): Promise<SyncReport> {
    await this.recover();
    const now = this.now();
    const batch = await this.due(now);
    const report: SyncReport = { attempted: batch.length, accepted: 0, retryable: 0, rejected: 0, transportFailed: false };
    if (batch.length === 0) return report;

    for (const r of batch) {
      await this.store.putRecord({ ...r, status: "in_flight" });
    }

    let outcomes: DeliveryOutcome[];
    try {
      outcomes = await this.transport.deliver(batch);
    } catch {
      // Total failure: every record returns to pending — nothing is lost.
      for (const r of batch) {
        await this.store.putRecord({ ...r, status: "pending" });
      }
      report.transportFailed = true;
      return report;
    }

    const byId = new Map(outcomes.map((o) => [o.id, o]));
    for (const r of batch) {
      const outcome = byId.get(r.id) ?? { id: r.id, outcome: "retryable" as const, error: "no_outcome_returned" };
      const attempts = r.attempts + 1;
      if (outcome.outcome === "accepted") {
        await this.store.putRecord({ ...r, status: "synced", attempts, serverId: outcome.serverId, lastError: undefined });
        report.accepted += 1;
      } else if (outcome.outcome === "rejected") {
        await this.store.putRecord({ ...r, status: "rejected", attempts, lastError: outcome.error ?? "rejected" });
        report.rejected += 1;
      } else {
        const nextAttemptAt = now + this.backoffSeconds(attempts) * 1000;
        await this.store.putRecord({ ...r, status: "pending", attempts, nextAttemptAt, lastError: outcome.error ?? "retryable" });
        report.retryable += 1;
      }
    }
    return report;
  }

  /**
   * Drain the backlog: repeatedly flush due batches until none remain due or
   * `maxRounds` is hit. Returns the aggregate report. Records in backoff are
   * left for a later call.
   */
  async syncAll(maxRounds = 1000): Promise<SyncReport> {
    const total: SyncReport = { attempted: 0, accepted: 0, retryable: 0, rejected: 0, transportFailed: false };
    for (let round = 0; round < maxRounds; round += 1) {
      const r = await this.sync();
      total.attempted += r.attempted;
      total.accepted += r.accepted;
      total.retryable += r.retryable;
      total.rejected += r.rejected;
      total.transportFailed = total.transportFailed || r.transportFailed;
      // Stop when nothing was attempted, or a round made no forward progress
      // (everything it tried came back retryable / the transport failed).
      if (r.attempted === 0 || r.transportFailed || r.accepted + r.rejected === 0) break;
    }
    return total;
  }
}
