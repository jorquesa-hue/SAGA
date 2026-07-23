# Webhooks & Connectors — operations

Covers the Automation and Integration context (`@jk/automation-integration`):
tenant webhooks (§51) and the connector framework (§33).

## What ships in this slice

- **Subscriptions** to an allowlisted set of event families
  (`animal, weight, health, reproduction, herd, inventory, finance, genetics,
  pasture, asset`). Sensitive contexts (identity/security, AI governance,
  device credentials) are never webhook-exposable.
- **Signed delivery**: HMAC-SHA256 over `timestamp.deliveryId.body`. Consumers
  recompute the signature and reject stale timestamps (default replay window
  300 s). Headers: `X-JK-Delivery-Id`, `X-JK-Event`, `X-JK-Timestamp`,
  `X-JK-Signature: v1=<hex>`.
- **Payload minimization** per family — only stable identifiers and
  non-sensitive descriptors leave the platform.
- **Retries** with exponential backoff, bounded by `max_attempts` (default 6),
  after which the delivery enters `dead_letter`. Every attempt is written to
  the append-only `webhook_delivery_attempt` log.
- **Manual replay** resets a `failed`/`dead_letter` delivery to `pending`.
- **Secret rotation** keeps the previous secret valid until the next rotation
  (overlap window), so consumers can roll their secret without dropped
  deliveries. `verifySignature` accepts either the current or previous secret.
- **Redirects are not followed** — the default `FetchWebhookTransport` uses
  `redirect: "manual"`; any 3xx is treated as a non-acknowledgement.

## Delivery model & tenant isolation

The webhook tables are `RLS FORCE` and granted to the app role only. Delivery
therefore runs **per tenant under a tenant context**, never as a cross-tenant
worker sweep. `WebhookDispatchScheduler` takes a pluggable `listTenantIds`
provider so the enumeration source (and its privilege) is an explicit, injected
decision:

```ts
const scheduler = createDispatchScheduler({
  appPool,                                  // jk_app (RLS-enforced)
  transport: new FetchWebhookTransport(),
  listTenantIds: async () => activeTenantIds(), // system-pool query in prod
});
setInterval(() => void scheduler.runOnce(), 5_000);
```

Event fan-out (`WebhookService.enqueueForEvent`) is likewise invoked per tenant
by an event projector that consumes the published domain-event stream; it is
idempotent per `(subscription, event)`.

> Deployment note: which process hosts the scheduler, and how it obtains the
> active-tenant list without broad owner-pool access, is tracked as a
> hardening decision for Phase 5 Slice 3. The library components here are the
> tested mechanism; the enumeration source is intentionally left injectable.

## Connector framework (§33)

`ConnectorAdapter` sits behind a stable domain interface and declares its
`ConnectorContract` — authentication, idempotency, retry, rate limit,
reconciliation, observability, version, and failure mode. The built-in
`WEBHOOK_ADAPTER` documents the webhook connector's contract. Tenant installs
are recorded in `connector_registration`; configuration is non-secret and
credentials are referenced, never stored inline.
