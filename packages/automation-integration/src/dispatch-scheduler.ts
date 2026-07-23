import { createTenantContext, newUuid, type TenantContext, type Uuid } from "@jk/domain-kernel";
import { DeliveryDispatcher, type DispatchResult, type WebhookTransport } from "./delivery-dispatcher.js";

/**
 * Per-tenant webhook dispatch scheduler (§51). Webhook tables are RLS-FORCEd
 * and granted to the app role only, so delivery MUST run per tenant under a
 * tenant context — never as a cross-tenant worker sweep. The scheduler is
 * therefore given a pluggable `listTenantIds` provider (a system-pool query in
 * production, a fixed list in tests) and iterates tenants, running the
 * DeliveryDispatcher under a scheduled service-actor context for each.
 *
 * This keeps the enumeration source (and its privilege) an explicit,
 * injectable decision rather than baking owner-pool access into the worker.
 */

export interface DispatchSchedulerOptions {
  dispatcher: DeliveryDispatcher;
  /** Source of tenant ids to service this tick (e.g. active tenants). */
  listTenantIds: () => Promise<Uuid[]>;
  /** Injected clock for deterministic backoff scheduling under test. */
  clock?: () => number;
}

export interface SchedulerTickResult {
  tenants: number;
  totals: DispatchResult;
}

export class WebhookDispatchScheduler {
  private readonly dispatcher: DeliveryDispatcher;
  private readonly listTenantIds: () => Promise<Uuid[]>;
  private readonly clock: () => number;

  constructor(options: DispatchSchedulerOptions) {
    this.dispatcher = options.dispatcher;
    this.listTenantIds = options.listTenantIds;
    this.clock = options.clock ?? (() => Date.now());
  }

  /** Run one dispatch pass across all listed tenants. Never throws per tenant. */
  async runOnce(): Promise<SchedulerTickResult> {
    const totals: DispatchResult = { claimed: 0, delivered: 0, retried: 0, deadLettered: 0 };
    const tenantIds = await this.listTenantIds();
    for (const tenantId of tenantIds) {
      try {
        const result = await this.dispatcher.dispatchDue(this.serviceContext(tenantId), { nowMs: this.clock() });
        totals.claimed += result.claimed;
        totals.delivered += result.delivered;
        totals.retried += result.retried;
        totals.deadLettered += result.deadLettered;
      } catch {
        // A single tenant's failure never blocks the rest.
      }
    }
    return { tenants: tenantIds.length, totals };
  }

  private serviceContext(tenantId: Uuid): TenantContext {
    return createTenantContext({
      tenantId,
      actor: { type: "service", id: newUuid(), display: "webhook-dispatch-scheduler" },
      correlationId: newUuid(),
    });
  }
}

/** Build a transport-backed scheduler from parts (convenience factory). */
export function createDispatchScheduler(params: {
  appPool: Parameters<typeof buildDispatcher>[0]["appPool"];
  transport: WebhookTransport;
  listTenantIds: () => Promise<Uuid[]>;
  batchSize?: number;
  clock?: () => number;
}): WebhookDispatchScheduler {
  return new WebhookDispatchScheduler({
    dispatcher: buildDispatcher({ appPool: params.appPool, transport: params.transport, batchSize: params.batchSize }),
    listTenantIds: params.listTenantIds,
    clock: params.clock,
  });
}

function buildDispatcher(opts: {
  appPool: ConstructorParameters<typeof DeliveryDispatcher>[0]["appPool"];
  transport: WebhookTransport;
  batchSize?: number;
}): DeliveryDispatcher {
  return new DeliveryDispatcher({ appPool: opts.appPool, transport: opts.transport, batchSize: opts.batchSize });
}
