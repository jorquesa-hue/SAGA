import { type TenantContext, type Uuid } from "@jk/domain-kernel";
import { withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { signDelivery } from "./signing.js";

/**
 * Webhook delivery dispatcher (§51). Claims due deliveries for a tenant,
 * signs them, hands them to an injectable transport, and applies the delivery
 * policy: a 2xx acknowledgement marks the delivery delivered; anything else is
 * a retryable error with exponential backoff up to `max_attempts`, after which
 * the delivery enters the dead-letter state. Every attempt is logged. Redirects
 * are NOT followed — the transport treats 3xx as a non-ack.
 *
 * The dispatcher runs per tenant under RLS (a scheduler enumerates tenants and
 * invokes it with a service-actor context). `nowSeconds`/`nowMs` are injected
 * so backoff scheduling is deterministic under test.
 */

export interface WebhookTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface WebhookTransportResponse {
  statusCode: number;
}

export interface WebhookTransport {
  deliver(request: WebhookTransportRequest): Promise<WebhookTransportResponse>;
}

/** Backoff seconds per attempt number (1-based), capped. */
export function backoffSeconds(attempt: number, capSeconds = 3600): number {
  const base = 2 ** attempt * 15; // 30s, 60s, 120s, 240s, ...
  return Math.min(base, capSeconds);
}

export interface DispatchResult {
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
}

interface DueRow {
  id: Uuid;
  subscription_id: Uuid;
  delivery_id: Uuid;
  event_type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  url: string;
  secret: string;
  active: boolean;
}

export interface DeliveryDispatcherOptions {
  appPool: pg.Pool;
  transport: WebhookTransport;
  batchSize?: number;
}

export class DeliveryDispatcher {
  private readonly appPool: pg.Pool;
  private readonly transport: WebhookTransport;
  private readonly batchSize: number;

  constructor(options: DeliveryDispatcherOptions) {
    this.appPool = options.appPool;
    this.transport = options.transport;
    this.batchSize = options.batchSize ?? 50;
  }

  /**
   * Dispatch all due deliveries for the tenant in `context`. A delivery is due
   * when its status is pending/failed and `next_attempt_at <= now`.
   */
  async dispatchDue(
    context: TenantContext,
    clock: { nowMs: number } = { nowMs: nowMsFallback() },
  ): Promise<DispatchResult> {
    const nowSeconds = Math.floor(clock.nowMs / 1000);
    const result: DispatchResult = { claimed: 0, delivered: 0, retried: 0, deadLettered: 0 };

    // Claim a batch of due deliveries (skip-locked so multiple dispatchers can
    // run), joined to their subscription for url/secret. Inactive subscriptions'
    // deliveries are claimed only to be marked failed (they will not deliver).
    const batch = await withTenantTransaction(this.appPool, context, async (client) => {
      const rows = await client.query<DueRow>(
        `SELECT d.id, d.subscription_id, d.delivery_id, d.event_type, d.payload,
                d.attempts, d.max_attempts, s.url, s.secret, s.active
           FROM webhook_delivery d
           JOIN webhook_subscription s ON s.id = d.subscription_id
          WHERE d.status IN ('pending','failed')
            AND d.next_attempt_at <= to_timestamp($1)
          ORDER BY d.next_attempt_at
          LIMIT $2
          FOR UPDATE OF d SKIP LOCKED`,
        [nowSeconds, this.batchSize],
      );
      // Mark claimed rows as 'delivering' so a concurrent pass won't re-claim.
      for (const row of rows.rows) {
        await client.query(`UPDATE webhook_delivery SET status = 'delivering' WHERE id = $1`, [row.id]);
      }
      return rows.rows;
    });
    result.claimed = batch.length;

    for (const row of batch) {
      const outcome = await this.attempt(context, row, nowSeconds);
      if (outcome === "delivered") result.delivered += 1;
      else if (outcome === "dead_letter") result.deadLettered += 1;
      else result.retried += 1;
    }
    return result;
  }

  private async attempt(
    context: TenantContext,
    row: DueRow,
    nowSeconds: number,
  ): Promise<"delivered" | "retried" | "dead_letter"> {
    const attemptNumber = row.attempts + 1;
    const body = JSON.stringify(row.payload);
    let statusCode: number | null = null;
    let error: string | null = null;

    if (!row.active) {
      error = "subscription_inactive";
    } else {
      const signed = signDelivery({
        secret: row.secret,
        deliveryId: row.delivery_id,
        eventType: row.event_type,
        body,
        timestampSeconds: nowSeconds,
      });
      try {
        const response = await this.transport.deliver({
          url: row.url,
          headers: { "content-type": "application/json", ...signed.headers },
          body,
        });
        statusCode = response.statusCode;
      } catch (e) {
        error = e instanceof Error ? e.message : "transport_error";
      }
    }

    const acknowledged = statusCode !== null && statusCode >= 200 && statusCode < 300;

    return withTenantTransaction(this.appPool, context, async (client) => {
      if (acknowledged) {
        await client.query(
          `UPDATE webhook_delivery
              SET status = 'delivered', attempts = $2, delivered_at = now(),
                  last_status_code = $3, last_error = NULL
            WHERE id = $1`,
          [row.id, attemptNumber, statusCode],
        );
        await this.logAttempt(client, context.tenantId, row.id, attemptNumber, "delivered", statusCode, null);
        return "delivered" as const;
      }

      const deadLetter = attemptNumber >= row.max_attempts;
      if (deadLetter) {
        await client.query(
          `UPDATE webhook_delivery
              SET status = 'dead_letter', attempts = $2, last_status_code = $3, last_error = $4
            WHERE id = $1`,
          [row.id, attemptNumber, statusCode, error ?? `http_${statusCode}`],
        );
        await this.logAttempt(client, context.tenantId, row.id, attemptNumber, "dead_letter", statusCode, error);
        return "dead_letter" as const;
      }

      const nextAt = nowSeconds + backoffSeconds(attemptNumber);
      await client.query(
        `UPDATE webhook_delivery
            SET status = 'failed', attempts = $2, last_status_code = $3, last_error = $4,
                next_attempt_at = to_timestamp($5)
          WHERE id = $1`,
        [row.id, attemptNumber, statusCode, error ?? `http_${statusCode}`, nextAt],
      );
      await this.logAttempt(client, context.tenantId, row.id, attemptNumber, "retryable_error", statusCode, error);
      return "retried" as const;
    });
  }

  private async logAttempt(
    client: pg.PoolClient,
    tenantId: string,
    deliveryId: string,
    attemptNumber: number,
    outcome: "delivered" | "retryable_error" | "dead_letter",
    statusCode: number | null,
    error: string | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO webhook_delivery_attempt
         (tenant_id, delivery_id, attempt_number, outcome, status_code, error)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, deliveryId, attemptNumber, outcome, statusCode, error],
    );
  }
}

function nowMsFallback(): number {
  return Date.now();
}

/**
 * Default HTTP transport (fetch). Redirects are NOT followed (§51): a 3xx is
 * returned as-is and treated as a non-acknowledgement by the dispatcher.
 */
export class FetchWebhookTransport implements WebhookTransport {
  constructor(private readonly timeoutMs = 10_000) {}

  async deliver(request: WebhookTransportRequest): Promise<WebhookTransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        redirect: "manual",
        signal: controller.signal,
      });
      return { statusCode: response.status };
    } finally {
      clearTimeout(timer);
    }
  }
}
