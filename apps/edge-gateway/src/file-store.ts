import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LocalStore, OutboxRecord, OutboxStatus } from "@jk/offline-sync";

interface Snapshot {
  records: Record<string, OutboxRecord>;
  checkpoints: Record<string, string>;
}

/**
 * Durable file-backed LocalStore for the edge gateway (§34: local buffer that
 * survives restarts and power loss). The whole snapshot is loaded on start and
 * written through on every mutation via a temp-file rename (atomic on POSIX),
 * so a crash mid-write never corrupts the buffer. Sufficient for a gateway's
 * moderate backlog; a SQLite adapter is the drop-in for very high volume.
 */
export class FileLocalStore implements LocalStore {
  private readonly path: string;
  private snapshot: Snapshot;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.snapshot = this.load();
  }

  private load(): Snapshot {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Snapshot;
    } catch {
      return { records: {}, checkpoints: {} };
    }
  }

  private persist(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.snapshot));
    renameSync(tmp, this.path);
  }

  async putRecord(record: OutboxRecord): Promise<void> {
    this.snapshot.records[record.id] = { ...record };
    this.persist();
  }

  async getRecord(id: string): Promise<OutboxRecord | undefined> {
    const r = this.snapshot.records[id];
    return r ? { ...r } : undefined;
  }

  async listByStatus(status: OutboxStatus): Promise<OutboxRecord[]> {
    return Object.values(this.snapshot.records)
      .filter((r) => r.status === status)
      .sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id))
      .map((r) => ({ ...r }));
  }

  async countByStatus(status: OutboxStatus): Promise<number> {
    let n = 0;
    for (const r of Object.values(this.snapshot.records)) if (r.status === status) n += 1;
    return n;
  }

  async getCheckpoint(stream: string): Promise<string | undefined> {
    return this.snapshot.checkpoints[stream];
  }

  async setCheckpoint(stream: string, cursor: string): Promise<void> {
    this.snapshot.checkpoints[stream] = cursor;
    this.persist();
  }
}
