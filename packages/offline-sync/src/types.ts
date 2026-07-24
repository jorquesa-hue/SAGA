/**
 * Offline-first sync types (§34). The mobile/edge clients capture observations
 * and commands into a durable local OUTBOX while offline, then flush them to
 * the server at-least-once with idempotency. Critical invariant #4: an
 * observation is NEVER silently lost — it stays in the outbox until the server
 * acknowledges it, or it is explicitly parked for human review.
 */

export type OutboxStatus =
  | "pending" // captured locally, not yet sent
  | "in_flight" // handed to the transport this round
  | "synced" // server acknowledged (accepted)
  | "rejected"; // server permanently rejected (kept for review, never dropped)

export interface OutboxRecord {
  /** Client-generated stable id; also the idempotency key sent to the server. */
  id: string;
  /** What this record is — an observation (e.g. a weight) or a command. */
  kind: "observation" | "command";
  /** Logical endpoint/operation the record targets (transport maps it). */
  operation: string;
  /** The captured payload (already validated at capture time). */
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms the record was captured. */
  capturedAt: number;
  /** Epoch ms before which the record must not be retried (backoff). */
  nextAttemptAt: number;
  /** Server id assigned on acceptance, for local reconciliation. */
  serverId?: string;
  lastError?: string;
}

/** Per-record result the transport returns for a flush round. */
export interface DeliveryOutcome {
  id: string;
  /** accepted → synced; retryable → stays pending with backoff; rejected → parked. */
  outcome: "accepted" | "retryable" | "rejected";
  serverId?: string;
  error?: string;
}

export interface SyncTransport {
  /**
   * Deliver a batch of records to the server. MUST be idempotent by record id
   * (the server dedupes on the idempotency key). Should resolve with one
   * outcome per input record. May throw on a total network failure — the
   * engine treats that as "all still pending" (nothing lost).
   */
  deliver(records: OutboxRecord[]): Promise<DeliveryOutcome[]>;
}

/**
 * Durable local storage abstraction. On device this is backed by an encrypted
 * SQLite/AsyncStorage adapter; in tests, an in-memory implementation. The
 * engine only depends on this interface, so it runs unchanged everywhere.
 */
export interface LocalStore {
  putRecord(record: OutboxRecord): Promise<void>;
  getRecord(id: string): Promise<OutboxRecord | undefined>;
  /** All records in a given status, oldest first. */
  listByStatus(status: OutboxStatus): Promise<OutboxRecord[]>;
  countByStatus(status: OutboxStatus): Promise<number>;
  /** Read-model sync checkpoint (opaque cursor) per stream. */
  getCheckpoint(stream: string): Promise<string | undefined>;
  setCheckpoint(stream: string, cursor: string): Promise<void>;
}
