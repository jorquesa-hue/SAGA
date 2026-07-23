import { randomBytes } from "node:crypto";
import {
  createEventEnvelope,
  newUuid,
  NotFoundError,
  ValidationError,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import { appendEvent, withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { z } from "zod";
import { decide, loadCallerMemberships } from "./authorization.js";
import { EventFamilyNotAllowedError, IntegrationForbiddenError } from "./errors.js";
import { familyOf, isAllowedFamily, projectPayload } from "./event-families.js";
import { parse } from "./connector-registry.js";

/**
 * Tenant webhook subscriptions and delivery fan-out (§51). Subscriptions are
 * restricted to allowlisted event families; delivery bodies are minimized per
 * family. Secrets are generated server-side and shown once; rotation keeps the
 * previous secret valid until the next rotation (overlap window). Fan-out is
 * idempotent per (subscription, event).
 */

export const WEBHOOK_SUBSCRIBED = "webhook.subscription_created.v1";
export const WEBHOOK_SECRET_ROTATED = "webhook.secret_rotated.v1";

export const subscribeInputSchema = z
  .object({
    url: z.string().url().startsWith("https://", "webhook URL must be https"),
    eventFamilies: z.array(z.string().min(1)).min(1),
    description: z.string().max(500).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type SubscribeInput = z.input<typeof subscribeInputSchema>;

export interface WebhookSubscription {
  id: Uuid;
  url: string;
  eventFamilies: string[];
  description: string | null;
  active: boolean;
}

export interface WebhookSubscriptionWithSecret extends WebhookSubscription {
  /** Returned ONCE at creation/rotation; never persisted in read models. */
  secret: string;
}

export interface WebhookDelivery {
  id: Uuid;
  subscriptionId: Uuid;
  deliveryId: Uuid;
  eventId: string;
  eventType: string;
  eventFamily: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
}

export interface EnqueueEventInput {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface WebhookServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

function newSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export class WebhookService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: WebhookServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  /** Create a subscription to allowlisted families. Returns the secret once. */
  async subscribe(context: TenantContext, rawInput: SubscribeInput): Promise<WebhookSubscriptionWithSecret> {
    const input = parse(subscribeInputSchema, rawInput);
    const families = [...new Set(input.eventFamilies)];
    const rejected = families.filter((f) => !isAllowedFamily(f));
    if (rejected.length > 0) {
      throw new EventFamilyNotAllowedError(
        `event families not allowlisted for webhooks: ${rejected.join(", ")}`,
        rejected,
      );
    }
    return this.manage(context, async (client) => {
      const id = newUuid();
      const secret = newSecret();
      const append = await appendEvent(
        client,
        createEventEnvelope({
          eventType: WEBHOOK_SUBSCRIBED,
          context,
          aggregateType: "webhook_subscription",
          aggregateId: id,
          aggregateVersion: 1,
          source: { channel: "system" },
          idempotencyKey: input.idempotencyKey ?? `webhook-sub-${id}`,
          payload: { subscriptionId: id, eventFamilies: families },
        }),
        { environment: this.environment },
      );
      await client.query(
        `INSERT INTO webhook_subscription (id, tenant_id, url, event_families, description, secret, active, event_id)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7)`,
        [id, context.tenantId, input.url, families, input.description ?? null, secret, append.eventId],
      );
      return { id, url: input.url, eventFamilies: families, description: input.description ?? null, active: true, secret };
    });
  }

  async listSubscriptions(context: TenantContext): Promise<WebhookSubscription[]> {
    return this.read(context, async (client) => {
      const result = await client.query<SubscriptionRow>(
        `SELECT id, url, event_families, description, active FROM webhook_subscription ORDER BY created_at DESC`,
      );
      return result.rows.map(toSubscription);
    });
  }

  async getSubscription(context: TenantContext, id: Uuid): Promise<WebhookSubscription> {
    return this.read(context, async (client) => {
      const row = await this.loadSubscription(client, id);
      return toSubscription(row);
    });
  }

  /** Rotate the signing secret (§51). Old secret becomes the overlap secret. */
  async rotateSecret(context: TenantContext, id: Uuid): Promise<WebhookSubscriptionWithSecret> {
    return this.manage(context, async (client) => {
      const row = await this.loadSubscription(client, id);
      const secret = newSecret();
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: WEBHOOK_SECRET_ROTATED,
          context,
          aggregateType: "webhook_subscription",
          aggregateId: id,
          aggregateVersion: 2,
          source: { channel: "system" },
          idempotencyKey: `webhook-rotate-${id}-${secret.slice(7, 19)}`,
          payload: { subscriptionId: id },
        }),
        { environment: this.environment },
      );
      await client.query(
        `UPDATE webhook_subscription
            SET secret_previous = secret, secret = $2, secret_rotated_at = now()
          WHERE id = $1`,
        [id, secret],
      );
      return { ...toSubscription(row), secret };
    });
  }

  async deactivate(context: TenantContext, id: Uuid): Promise<void> {
    await this.manage(context, async (client) => {
      const result = await client.query(`UPDATE webhook_subscription SET active = false WHERE id = $1`, [id]);
      if (result.rowCount === 0) throw new NotFoundError(`Subscription ${id} not found`);
    });
  }

  /**
   * Fan an event out to every active subscription whose families include the
   * event's family. Idempotent per (subscription, event). Sensitive contexts
   * are never enqueued (familyOf returns a non-allowlisted family → skipped).
   * Returns the number of deliveries newly enqueued.
   */
  async enqueueForEvent(context: TenantContext, event: EnqueueEventInput): Promise<number> {
    const family = familyOf(event.eventType);
    if (!isAllowedFamily(family)) return 0;
    const body = projectPayload(family, event.payload);
    // The dispatcher runs as a service actor; enqueue may be called by either
    // a service (relay) or a management user (manual test send).
    return this.manage(context, async (client) => {
      const subs = await client.query<{ id: Uuid }>(
        `SELECT id FROM webhook_subscription
          WHERE active = true AND $1 = ANY(event_families)`,
        [family],
      );
      let enqueued = 0;
      for (const sub of subs.rows) {
        const result = await client.query(
          `INSERT INTO webhook_delivery
             (tenant_id, subscription_id, event_id, event_family, event_type, payload, status, next_attempt_at)
           VALUES ($1,$2,$3,$4,$5,$6,'pending', now())
           ON CONFLICT (subscription_id, event_id) DO NOTHING`,
          [context.tenantId, sub.id, event.eventId, family, event.eventType, JSON.stringify(body)],
        );
        enqueued += result.rowCount ?? 0;
      }
      return enqueued;
    });
  }

  async listDeliveries(
    context: TenantContext,
    filter: { status?: string; subscriptionId?: string } = {},
  ): Promise<WebhookDelivery[]> {
    return this.read(context, async (client) => {
      const result = await client.query<DeliveryRow>(
        `SELECT id, subscription_id, delivery_id, event_id, event_type, event_family,
                status, attempts, max_attempts, last_status_code, last_error
           FROM webhook_delivery
          WHERE ($1::text IS NULL OR status = $1)
            AND ($2::uuid IS NULL OR subscription_id = $2)
          ORDER BY created_at DESC`,
        [filter.status ?? null, filter.subscriptionId ?? null],
      );
      return result.rows.map(toDelivery);
    });
  }

  /** Manual replay of a failed/dead-letter delivery (§51). Resets to pending. */
  async replayDelivery(context: TenantContext, id: Uuid): Promise<WebhookDelivery> {
    return this.manage(context, async (client) => {
      const result = await client.query<DeliveryRow & { attempts: number }>(
        `SELECT id, subscription_id, delivery_id, event_id, event_type, event_family,
                status, attempts, max_attempts, last_status_code, last_error
           FROM webhook_delivery WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) throw new NotFoundError(`Delivery ${id} not found`);
      const row = result.rows[0]!;
      if (row.status !== "failed" && row.status !== "dead_letter") {
        throw new ValidationError(`Delivery ${id} is not in a replayable state (${row.status})`);
      }
      await client.query(
        `UPDATE webhook_delivery
            SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL, last_status_code = NULL
          WHERE id = $1`,
        [id],
      );
      await client.query(
        `INSERT INTO webhook_delivery_attempt (tenant_id, delivery_id, attempt_number, outcome)
         VALUES ($1,$2,$3,'replayed')`,
        [context.tenantId, id, row.attempts],
      );
      return toDelivery({ ...row, status: "pending", attempts: 0, last_status_code: null, last_error: null });
    });
  }

  // -- internals --
  private async loadSubscription(client: pg.PoolClient, id: string): Promise<SubscriptionRow> {
    const result = await client.query<SubscriptionRow>(
      `SELECT id, url, event_families, description, active FROM webhook_subscription WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) throw new NotFoundError(`Subscription ${id} not found`);
    return result.rows[0]!;
  }

  private async manage<T>(context: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide("manage_integrations", context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new IntegrationForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }

  private async read<T>(context: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide("read", context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new IntegrationForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}

interface SubscriptionRow {
  id: Uuid;
  url: string;
  event_families: string[];
  description: string | null;
  active: boolean;
}

interface DeliveryRow {
  id: Uuid;
  subscription_id: Uuid;
  delivery_id: Uuid;
  event_id: string;
  event_type: string;
  event_family: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_status_code: number | null;
  last_error: string | null;
}

function toSubscription(row: SubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    url: row.url,
    eventFamilies: row.event_families,
    description: row.description,
    active: row.active,
  };
}

function toDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    deliveryId: row.delivery_id,
    eventId: row.event_id,
    eventType: row.event_type,
    eventFamily: row.event_family,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
  };
}
