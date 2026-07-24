import type { LocalStore, OutboxRecord, OutboxStatus } from "@jk/offline-sync";

/**
 * Minimal async key/value contract — exactly the surface React Native's
 * AsyncStorage (and most encrypted KV libs) already provide. On device you pass
 * AsyncStorage; in tests, an in-memory Map-backed implementation.
 */
export interface AsyncKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

const RECORD_PREFIX = "jk.obx.";
const CHECKPOINT_PREFIX = "jk.cp.";

/**
 * A durable {@link LocalStore} backed by an {@link AsyncKv}. This is the device
 * adapter the offline-sync engine runs against unchanged; it just persists and
 * reloads records, so the engine's never-lose guarantees hold across app
 * restarts (records survive because they are written before capture returns).
 */
export class AsyncKvLocalStore implements LocalStore {
  constructor(private readonly kv: AsyncKv) {}

  async putRecord(record: OutboxRecord): Promise<void> {
    await this.kv.setItem(RECORD_PREFIX + record.id, JSON.stringify(record));
  }

  async getRecord(id: string): Promise<OutboxRecord | undefined> {
    const raw = await this.kv.getItem(RECORD_PREFIX + id);
    return raw ? (JSON.parse(raw) as OutboxRecord) : undefined;
  }

  private async allRecords(): Promise<OutboxRecord[]> {
    const keys = (await this.kv.getAllKeys()).filter((k) => k.startsWith(RECORD_PREFIX));
    const out: OutboxRecord[] = [];
    for (const key of keys) {
      const raw = await this.kv.getItem(key);
      if (raw) out.push(JSON.parse(raw) as OutboxRecord);
    }
    return out;
  }

  async listByStatus(status: OutboxStatus): Promise<OutboxRecord[]> {
    return (await this.allRecords())
      .filter((r) => r.status === status)
      .sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id));
  }

  async countByStatus(status: OutboxStatus): Promise<number> {
    return (await this.allRecords()).filter((r) => r.status === status).length;
  }

  async getCheckpoint(stream: string): Promise<string | undefined> {
    return (await this.kv.getItem(CHECKPOINT_PREFIX + stream)) ?? undefined;
  }

  async setCheckpoint(stream: string, cursor: string): Promise<void> {
    await this.kv.setItem(CHECKPOINT_PREFIX + stream, cursor);
  }
}

/** In-memory AsyncKv — the reference the device AsyncStorage adapter mirrors. */
export class MemoryAsyncKv implements AsyncKv {
  private readonly map = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }
  async getAllKeys(): Promise<readonly string[]> {
    return [...this.map.keys()];
  }
}
