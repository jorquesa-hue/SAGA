# Production hardening checklist

Status of the cross-cutting production concerns for SAGA, and
where each is enforced. Items marked **deferred** have a named owner
(ADR/blocker) and are not silently assumed done.

## Tenant isolation (invariant #1)

- **Enforced.** Every tenant table is `ROW LEVEL SECURITY … FORCE` with a
  fail-closed policy (`tenant_id = NULLIF(current_setting('app.tenant_id',
true), '')::uuid`). The app role (`jk_app`) can never see across tenants; the
  worker role (`jk_worker`) has narrow cross-tenant scope on the outbox only.
- **Tested.** `pnpm test:tenant-isolation` runs the cross-tenant attack suite;
  every feature package's integration suite asserts no cross-tenant leakage.

## Immutable history (invariant #2)

- **Enforced.** Domain events are append-only (`forbid_event_mutation`
  trigger); corrections are compensating events. Audit ledgers
  (`ai_action_audit`, `webhook_delivery_attempt`, `export_access_log`,
  `financial_entry`) carry the same no-update/no-delete trigger.

## Secrets & data protection

- **No secrets in the repo/fixtures** (invariant #7). Config is typed and fails
  startup on invalid critical values (Appendix G). Structured logs never emit
  headers, tokens, or bodies.
- **Webhook signing secrets** are generated server-side, shown once, and
  rotatable with an overlap window (§51). They are excluded from all read
  models.
- **Export artifacts** are time-limited (default 7 days), checksummed
  (SHA-256), and every download is audited (§27).
- **Encryption at rest** — deferred to the storage layer: object storage
  (MinIO/S3 SSE) and encrypted volumes provide at-rest encryption for export
  artifacts and attachments. Tracked with the cloud/identity decisions in
  `docs/adr/` (ADR-001..ADR-010).

## Governed AI (invariant #6)

- **Enforced.** Recommendations are evidence-bound with confidence and
  model/prompt provenance; prohibited actions can never auto-execute;
  high-impact actions require human approval; a per-tenant kill switch disables
  generation. All actions are audited.

## Delivery & retries (invariant #5)

- **Enforced.** The transactional outbox gives at-least-once publication;
  webhook delivery uses bounded exponential backoff, dead-letter, and manual
  replay; external commands are idempotent (`Idempotency-Key`).

## Observability

- **Enforced.** Structured logs/traces with correlation ids across API and
  worker; health probes (`/health/live`, `/health/ready`) on both services.
- **Deferred (Phase 6+):** dashboards, SLO alerting wiring, and the OTel
  collector pipeline are provisioned in compose but not yet dashboarded.

## Still open (named)

- **Webhook dispatch host & tenant enumeration.** The dispatch scheduler is a
  tested library component with an injected tenant-id provider; which process
  hosts it and how it lists active tenants without broad owner-pool access is a
  deployment decision (see `docs/operations/webhooks-and-connectors.md`).
- **ADR-001..ADR-010** — vendor/cloud/identity/model-provider decisions remain
  open and gate the corresponding production integrations.
- **Frontend & edge apps** (web, mobile offline-first, sync, edge-gateway,
  ai-orchestrator) are the next delivery phase and are not part of the
  backend-complete milestone.
