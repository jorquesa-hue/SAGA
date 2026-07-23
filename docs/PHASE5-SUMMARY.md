# Phase 5 — Governed AI, Integration, and Exports

Phase 5 completes the platform-services layer on top of the Phase 1–4 domain.
It is delivered in three vertical slices, each with migration, service,
authorization, events, tests, contracts, and traceability.

## Slice 1 — Governed AI recommendations (§61–§64, invariant #6)

- `recommendation` + `ai_action_audit` (append-only) tables; RLS FORCE.
- `@jk/analytics-intelligence`: `ai-safety` (prohibited/safe action assessment,
  typed guard errors) and `recommendation-service` (evidence-bound create,
  human approval, prohibited-action block, per-tenant kill switch).
- Scenario #12 proven end-to-end: an agent may *propose* a prohibited action
  (e.g. euthanasia) but autonomous execution is blocked and audited; even after
  human approval it never auto-executes.
- REST surface: `/recommendations` (+ approve/reject/execute).

## Slice 2 — Connector framework & tenant webhooks (§33, §51)

- `webhook_subscription`, `webhook_delivery`, `webhook_delivery_attempt`
  (append-only), `connector_registration`; RLS FORCE.
- `@jk/automation-integration`: allowlisted event families with per-family
  payload minimization; HMAC signing with replay window and secret-rotation
  overlap; bounded-backoff retries → dead-letter → manual replay; a per-tenant
  dispatch scheduler with an injectable tenant source; the §33 connector
  adapter contract.
- REST surface: `/webhooks/subscriptions` (+ rotate-secret, deliveries, replay)
  and `/connectors`.

## Slice 3 — Secure exports & animal traceability packet (§27, JK-ANI-006)

- `export_job` + `export_access_log` (append-only); RLS FORCE.
- `@jk/analytics-intelligence`: `export-service` — asynchronous
  request → process → download lifecycle; tenant-scoped, time-limited (7-day
  default), SHA-256 checksummed, and audited on every state change and
  download. The animal traceability packet assembles identity, identifiers,
  weights, restrictions, and event timeline, rendered as JSON or CSV; the
  download path is the QR-resolvable link.
- REST surface: `/exports` (+ process, download).

## Verification

- Migrations `0015`–`0017` apply cleanly from zero (testkit).
- Integration tests: analytics-intelligence 23 passing (recommendations 8,
  exports 6, farm-intelligence 3, analytics 6 + skips); automation-integration
  12 passing.
- Gates green: `architecture:check` (17 packages), `lint`, `typecheck`,
  `contracts:validate` (9 documents).

## What remains

- Production hardening items with named owners — see
  `docs/operations/production-hardening.md`.
- Frontend and edge applications (web, mobile offline-first, sync,
  edge-gateway, ai-orchestrator) — the next delivery phase.
