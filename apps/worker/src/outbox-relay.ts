import { validateEventEnvelope, type DomainEventEnvelope } from "@jk/domain-kernel";
import type pg from "pg";
import { silentLogger, type Logger } from "./logger.js";
import { type EventPublisher } from "./publisher.js";
import { type EventStatsProjector } from "./projector.js";

/**
 * Transactional outbox relay (§31.1 step 4, §31.2).
 *
 * Polls outbox_message on the WORKER pool (jk_worker: cross-tenant scoped
 * policies, least privilege — SELECT/UPDATE on outbox only). A batch is
 * claimed with FOR UPDATE SKIP LOCKED inside one transaction so any number of
 * relay instances can run concurrently without double-claiming a message.
 *
 * Per message, inside a SAVEPOINT:
 *   publish → mark published_at/publish_attempts → feed the in-process
 *   projector (Phase 0 consumer wiring).
 * On any failure the SAVEPOINT is rolled back and last_error +
 * publish_attempts are recorded instead; the loop never crashes and the
 * message is retried on the next run (at-least-once; broker/consumer dedupe
 * absorb duplicates).
 */

export interface RelayRunResult {
  /** Messages claimed in this batch. */
  polled: number;
  /** Successfully published and marked. */
  published: number;
  /** Failed; last_error recorded for retry on the next run. */
  failed: number;
  /** Envelopes newly applied by the projector (deduplicated ones excluded). */
  projected: number;
}

interface OutboxRow {
  message_id: string;
  event_id: string;
  subject: string;
  envelope: DomainEventEnvelope;
  publish_attempts: number;
}

export interface OutboxRelayOptions {
  /** Pool connected as the worker role (jk_worker). */
  pool: pg.Pool;
  publisher: EventPublisher;
  /** Optional in-process projection consumer fed after successful publish. */
  projector?: EventStatsProjector;
  /** Poll batch size; default 50. */
  batchSize?: number;
  logger?: Logger;
}

export class OutboxRelay {
  private readonly pool: pg.Pool;
  private readonly publisher: EventPublisher;
  private readonly projector: EventStatsProjector | undefined;
  private readonly batchSize: number;
  private readonly logger: Logger;

  private stopRequested = false;
  private loopPromise: Promise<void> | null = null;
  private sleepTimer: NodeJS.Timeout | null = null;
  private wake: (() => void) | null = null;

  constructor(options: OutboxRelayOptions) {
    this.pool = options.pool;
    this.publisher = options.publisher;
    this.projector = options.projector;
    this.batchSize = options.batchSize ?? 50;
    this.logger = options.logger ?? silentLogger;
  }

  /** Claim and process one batch. Never throws for per-message failures. */
  async runOnce(): Promise<RelayRunResult> {
    const result: RelayRunResult = { polled: 0, published: 0, failed: 0, projected: 0 };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const batch = await client.query<OutboxRow>(
        `SELECT message_id, event_id, subject, envelope, publish_attempts
           FROM outbox_message
          WHERE published_at IS NULL
          ORDER BY created_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [this.batchSize],
      );
      result.polled = batch.rows.length;

      for (const row of batch.rows) {
        await client.query("SAVEPOINT relay_message");
        try {
          const envelope = validateEventEnvelope(row.envelope);
          await this.publisher.publish(row.subject, envelope);
          await client.query(
            `UPDATE outbox_message
                SET published_at = now(),
                    publish_attempts = publish_attempts + 1,
                    last_error = NULL
              WHERE message_id = $1`,
            [row.message_id],
          );
          if (this.projector) {
            const projection = await this.projector.project(client, envelope);
            if (projection.applied) result.projected += 1;
          }
          await client.query("RELEASE SAVEPOINT relay_message");
          result.published += 1;
          this.logger.info("outbox_message_published", {
            messageId: row.message_id,
            eventId: row.event_id,
            subject: row.subject,
            correlationId: envelope.correlationId,
          });
        } catch (error) {
          // Restore the transaction (a SQL error aborts it), keep the claim
          // lock, and record the failure for retry — never crash the batch.
          await client.query("ROLLBACK TO SAVEPOINT relay_message");
          await client.query(
            `UPDATE outbox_message
                SET publish_attempts = publish_attempts + 1,
                    last_error = $2
              WHERE message_id = $1`,
            [row.message_id, truncateError(error)],
          );
          result.failed += 1;
          this.logger.error("outbox_message_publish_failed", {
            messageId: row.message_id,
            eventId: row.event_id,
            subject: row.subject,
            attempts: row.publish_attempts + 1,
            error: truncateError(error),
          });
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return result;
  }

  /** Start the poll loop. Idempotent while running. */
  start(intervalMs: number): void {
    if (this.loopPromise) return;
    this.stopRequested = false;
    this.loopPromise = this.loop(intervalMs);
  }

  /** Request a clean stop and wait for the in-flight batch to finish. */
  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.wake?.();
    await this.loopPromise?.catch(() => {});
    this.loopPromise = null;
  }

  private async loop(intervalMs: number): Promise<void> {
    while (!this.stopRequested) {
      try {
        await this.runOnce();
      } catch (error) {
        // Batch-level failure (e.g. database restart): log and retry next tick.
        this.logger.error("outbox_relay_run_failed", { error: truncateError(error) });
      }
      if (this.stopRequested) break;
      await this.sleep(intervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
      this.sleepTimer = setTimeout(resolve, ms);
      this.sleepTimer.unref?.();
    });
  }
}

function truncateError(error: unknown, max = 1000): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.length > max ? `${message.slice(0, max)}…` : message;
}
