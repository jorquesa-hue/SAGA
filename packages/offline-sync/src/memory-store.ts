import type { LocalStore, OutboxRecord, OutboxStatus } from "./types.js";

/**
 * In-memory LocalStore — the reference implementation used in tests and as the
 * contract every device adapter (encrypted SQLite / AsyncStorage) must honor.
 * Records are cloned on the way in and out so callers can't mutate stored
 * state by reference (a durable store would serialize them).
 */
export class InMemoryLocalStore implements LocalStore {
  private readonly records = new Map<string, OutboxRecord>();
  private readonly checkpoints = new Map<string, string>();

  async putRecord(record: OutboxRecord): Promise<void> {
    this.records.set(record.id, { ...record });
  }

  async getRecord(id: string): Promise<OutboxRecord | undefined> {
    const r = this.records.get(id);
    return r ? { ...r } : undefined;
  }

  async listByStatus(status: OutboxStatus): Promise<OutboxRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.status === status)
      .sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id))
      .map((r) => ({ ...r }));
  }

  async countByStatus(status: OutboxStatus): Promise<number> {
    let n = 0;
    for (const r of this.records.values()) if (r.status === status) n += 1;
    return n;
  }

  async getCheckpoint(stream: string): Promise<string | undefined> {
    return this.checkpoints.get(stream);
  }

  async setCheckpoint(stream: string, cursor: string): Promise<void> {
    this.checkpoints.set(stream, cursor);
  }
}
