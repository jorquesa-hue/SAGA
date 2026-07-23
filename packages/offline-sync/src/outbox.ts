import type { LocalStore, OutboxRecord } from "./types.js";

export interface OutboxOptions {
  store: LocalStore;
  /** Injectable clock (epoch ms) for deterministic tests. */
  now?: () => number;
  /** Injectable id generator; the id is also the server idempotency key. */
  newId?: () => string;
}

export interface CaptureInput {
  kind: "observation" | "command";
  operation: string;
  payload: Record<string, unknown>;
  /** Stable client id; supply a deterministic one to dedupe re-captures. */
  id?: string;
}

function defaultNewId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback: not cryptographic, only used where randomUUID is absent.
  return `loc-${Math.trunc(performance.now?.() ?? 0)}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * Durable capture side of the offline outbox (§34). `capture` persists an
 * observation/command locally and returns immediately — the network is never
 * on the critical path of a field capture. Re-capturing the same id is
 * idempotent and never regresses a record that is already synced/rejected
 * (invariant #4: never lose or silently mutate a captured observation).
 */
export class Outbox {
  private readonly store: LocalStore;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: OutboxOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? defaultNewId;
  }

  async capture(input: CaptureInput): Promise<OutboxRecord> {
    const id = input.id ?? this.newId();
    const existing = await this.store.getRecord(id);
    if (existing) return existing; // idempotent capture

    const now = this.now();
    const record: OutboxRecord = {
      id,
      kind: input.kind,
      operation: input.operation,
      payload: input.payload,
      status: "pending",
      attempts: 0,
      capturedAt: now,
      nextAttemptAt: now,
    };
    await this.store.putRecord(record);
    return record;
  }

  pendingCount(): Promise<number> {
    return this.store.countByStatus("pending");
  }
  rejectedCount(): Promise<number> {
    return this.store.countByStatus("rejected");
  }
}
