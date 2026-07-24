# ADR-004: NATS JetStream hosting model

- **Status:** OPEN
- **Date:** 2026-07-22 (opened; not yet decided)
- **Deciders:** founder + engineering lead (pending)
- **Requirement IDs:** §30.1 (messaging baseline), §31.2 (at-least-once
  delivery), §49 (event topics), §78 (broker state backup)
- **Related:** [ADR-001](ADR-001-cloud-provider-and-region.md),
  [ADR-003](ADR-003-kubernetes-vs-serverless.md)

## Context

NATS JetStream is the fixed messaging baseline (§30.1: durable streams,
consumer replay, simple operations). What §93 leaves open is the **hosting
model**: Synadia Cloud / managed NATS vs operator-managed NATS on our own
compute. Stream durability matters (§78 requires broker configuration and
critical stream state to be backed up or reproducible), but the transactional
outbox (`outbox_message` in
`database/migrations/0001_core_tenancy_and_event_ledger.sql`) means Postgres,
not the broker, is the source of truth — streams are reproducible by replay.

## Decision

OPEN. **Default until decided (spec §93, verbatim):** _"Managed or
operator-managed based on reliability/cost."_

The repository honors the default today:

- The worker publishes through a pluggable `EventPublisher`
  (`apps/worker/src/publisher.ts`): NATS JetStream when `NATS_URL` is set,
  in-memory/log publishers otherwise — no hosting assumption leaks into
  domain code.
- `infrastructure/compose/docker-compose.yml` runs single-node NATS with
  JetStream (`-js -sd /data`) for local development.
- Subjects (`jk.{env}.{shard}.{context}.{aggregate}.{event}.vN`, built in
  `packages/database/src/event-store.ts`) are hosting-agnostic and never
  carry raw tenant ids.

**Decision criteria:**

1. Reliability/SLA vs operating a 3-node NATS cluster ourselves (small-team
   risk, §94).
2. Cost at Phase 1-2 event volume (§79: 1M events/tenant target).
3. Latency/regional availability next to the ADR-001 region.
4. Security: private connectivity, tenant-shard subject isolation, creds
   rotation (JK-IAM-006).
5. Backup/reproducibility story satisfying §78 (stream replay from the
   Postgres ledger is the fallback in either model).

## Consequences

Blocked until this closes:

- Production stream/consumer provisioning (streams, retention, replicas).
- Broker credentials management wiring in Terraform.
- End-to-end §32.2 sync-latency verification beyond local.

## Verification

`apps/worker/tests/unit/publisher.test.ts` proves publisher pluggability and
credential-free error surfaces; `apps/worker/tests/integration/` proves the
relay against the in-memory publisher without any broker dependency.
