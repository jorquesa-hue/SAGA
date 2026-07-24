import { type DomainEventEnvelope } from "@jk/domain-kernel";
import { connect, type JetStreamClient, type NatsConnection } from "nats";
import { createLogger, type Logger } from "./logger.js";

/**
 * Event publishers for the outbox relay (§31.1 step 4, §49).
 *
 * The relay is transport-agnostic: publishing is at-least-once, so every
 * publisher MUST tolerate redelivery of the same event. The NATS JetStream
 * publisher forwards the envelope's eventId as the broker msgID so JetStream
 * deduplicates redeliveries inside its dedupe window (§31.2: no business
 * workflow assumes exactly-once transport — this only reduces duplicates).
 */

export interface PublishedMessage {
  subject: string;
  envelope: DomainEventEnvelope;
}

export interface EventPublisher {
  publish(subject: string, envelope: DomainEventEnvelope): Promise<void>;
  /** Optional: flush/close underlying connections on shutdown. */
  close?(): Promise<void>;
}

/** Records published messages in memory. Test/dev double. */
export class InMemoryPublisher implements EventPublisher {
  readonly messages: PublishedMessage[] = [];

  async publish(subject: string, envelope: DomainEventEnvelope): Promise<void> {
    this.messages.push({ subject, envelope });
  }

  /** Distinct event ids seen (deduplication assertions in tests). */
  eventIds(): string[] {
    return this.messages.map((m) => m.envelope.eventId);
  }
}

/**
 * Local default publisher: emits one structured JSON line per event.
 * Logs subject + envelope identifiers only — never the payload and never the
 * raw tenant id (§49/§77: topics and logs do not expose tenant ids).
 */
export class LogPublisher implements EventPublisher {
  private readonly logger: Logger;

  constructor(logger: Logger = createLogger({ service: "jk-worker" })) {
    this.logger = logger;
  }

  async publish(subject: string, envelope: DomainEventEnvelope): Promise<void> {
    this.logger.info("event_published", {
      subject,
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      aggregateType: envelope.aggregateType,
      correlationId: envelope.correlationId,
    });
  }
}

/** Strip credentials from a NATS URL before it can reach an error message. */
export function sanitizeNatsUrl(natsUrl: string): string {
  try {
    const url = new URL(natsUrl);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "<invalid nats url>";
  }
}

/**
 * NATS JetStream publisher. Connects lazily on first publish so the worker
 * can boot (and stay healthy for /health/live) while the broker is still
 * starting. Only used when NATS_URL is configured and reachable.
 */
export class NatsJetStreamPublisher implements EventPublisher {
  private connection: NatsConnection | null = null;
  private jetstream: JetStreamClient | null = null;
  private connecting: Promise<JetStreamClient> | null = null;

  constructor(
    private readonly natsUrl: string,
    private readonly connectTimeoutMs = 5_000,
  ) {}

  private async ensureConnected(): Promise<JetStreamClient> {
    if (this.jetstream) return this.jetstream;
    this.connecting ??= (async () => {
      try {
        this.connection = await connect({
          servers: this.natsUrl,
          name: "jk-worker-outbox-relay",
          timeout: this.connectTimeoutMs,
        });
      } catch (error) {
        this.connecting = null;
        throw new Error(
          `Unable to connect to NATS at ${sanitizeNatsUrl(this.natsUrl)}: ` +
            `${(error as Error).message ?? String(error)}`,
          { cause: error },
        );
      }
      this.jetstream = this.connection.jetstream();
      return this.jetstream;
    })();
    return this.connecting;
  }

  async publish(subject: string, envelope: DomainEventEnvelope): Promise<void> {
    const jetstream = await this.ensureConnected();
    // msgID = eventId → JetStream broker-side dedupe of redeliveries (§31.2).
    await jetstream.publish(subject, JSON.stringify(envelope), {
      msgID: envelope.eventId,
    });
  }

  async close(): Promise<void> {
    this.connecting = null;
    this.jetstream = null;
    const connection = this.connection;
    this.connection = null;
    if (connection) {
      await connection.drain().catch(() => connection.close().catch(() => {}));
    }
  }
}
