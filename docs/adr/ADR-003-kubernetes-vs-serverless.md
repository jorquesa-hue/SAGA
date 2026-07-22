# ADR-003: Kubernetes vs managed serverless containers for first production

- **Status:** OPEN
- **Date:** 2026-07-22 (opened; not yet decided)
- **Deciders:** founder + engineering lead (pending)
- **Requirement IDs:** §30.1 (production baseline), §32 (deployment
  architecture), §76 (Kubernetes baseline), §79 (capacity baseline)
- **Related:** [ADR-001](ADR-001-cloud-provider-and-region.md),
  [ADR-004](ADR-004-nats-jetstream-hosting.md)

## Context

Spec §30.1 names Kubernetes + Helm + Terraform as the production baseline,
but §93 explicitly keeps open whether first production runs on Kubernetes or
on managed serverless containers (Cloud Run/App Runner/Container Apps
class), given a very small operations team (§94 "small-team operational
load"). The workloads are: API (stateless), worker/outbox relay (stateless,
scale-out safe via `FOR UPDATE SKIP LOCKED` — see
`apps/worker/src/outbox-relay.ts`), and later sync/edge/AI services.

## Decision

OPEN. **Default until decided (spec §93, verbatim):** *"Kubernetes specified
as target; cost/operations proof required."*

The repository honors the default today:

- `infrastructure/helm/jk-api/` is a real, lintable Helm chart; CI renders it
  offline in `.github/workflows/deploy.yml`.
- `infrastructure/docker/Dockerfile.api` and `Dockerfile.worker` are
  non-root, healthcheck-bearing images that run identically on either
  substrate.
- Nothing in application code assumes Kubernetes APIs.

**Decision criteria:**

1. Actual monthly cost comparison at §79 reference load (10k animals/tenant,
   100 concurrent users burst) — the spec demands "cost/operations proof".
2. Operations burden for a 1-3 person team: upgrades, node patching,
   secrets, network policy.
3. Fit for long-running consumers (NATS pull consumers may prefer
   always-on workers; serverless scale-to-zero conflicts with relay
   latency SLO in §32.2 sync targets).
4. Availability in the region chosen by ADR-001.
5. Escape hatch cost: Helm charts must stay deployable if serverless is
   chosen first (target remains Kubernetes per spec).

## Consequences

Blocked until this closes:

- Worker/sync Helm charts beyond `jk-api` (deliberately not built ahead of
  the proof).
- Autoscaling/resource-limit verification (Appendix L reliability gate).
- The smoke-deploy leg of §36's fitness functions.

## Verification

`helm lint` + offline `helm template` run in CI
(`.github/workflows/deploy.yml`); images stay substrate-neutral
(`infrastructure/docker/`).
