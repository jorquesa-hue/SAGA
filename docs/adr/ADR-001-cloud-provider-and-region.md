# ADR-001: Cloud provider and primary region

- **Status:** OPEN
- **Date:** 2026-07-22 (opened; not yet decided)
- **Deciders:** founder + engineering lead (pending)
- **Requirement IDs:** §32 (deployment), §75 (infrastructure baseline), §78
  (backup/DR), JK-SEC-002 (managed keys/secret manager), LGPD/§69 (data
  residency)
- **Related:** [ADR-003](ADR-003-kubernetes-vs-serverless.md) (compute model),
  [ADR-004](ADR-004-nats-jetstream-hosting.md) (broker hosting),
  [ADR-008](ADR-008-ai-model-providers.md) (AI data residency)

## Context

Spec §93 leaves the cloud provider and primary region undecided. Production
deployment, managed PostgreSQL, object storage, secret manager, registry,
and CI deployment credentials all hang off this choice. Customer data is
Brazilian farm data; §69 (LGPD) and latency to rural Brazil argue for a
Brazil or nearby region.

## Decision

OPEN. **Default until decided (spec §93, verbatim):** *"Provider-neutral
Terraform interfaces; Brazil/nearby compliant region evaluation."*

The repository honors the default today:

- `infrastructure/terraform/modules/jk-platform/` is a provider-neutral
  module contract (no provider-specific resources); consumed by
  `infrastructure/terraform/environments/local/`.
- `.github/workflows/deploy.yml` validates Helm/Terraform assets offline and
  already declares `id-token: write` so OIDC federation to the chosen cloud
  can be wired without a permissions change; it deliberately deploys nowhere.
- `.github/workflows/release.yml` defers container registry push/signing.

**Decision criteria:**

1. Availability of a managed PostgreSQL 16 + PostGIS offering with PITR
   (spec §78) in a Brazil/nearby region.
2. Managed Kubernetes and/or serverless container maturity and cost (feeds
   ADR-003).
3. Secret manager, KMS, and object-storage capabilities (JK-SEC-002,
   JK-SEC-007).
4. LGPD data-residency posture and contractual terms (§69).
5. Egress/latency to rural Brazilian connectivity profiles (§28).
6. Total monthly cost at Phase 0-2 scale for a small team (§94 "small-team
   operational load").

## Consequences

Blocked until this closes:

- Real `infrastructure/terraform/environments/{dev,staging,production}/`
  stacks (only `local/` exists).
- Container registry, image signing, SBOM attestation in
  `.github/workflows/release.yml` (noted inline in that file).
- Cluster smoke deploy step of §36's "clean-environment deployment" fitness
  function.
- Production backup/PITR automation in
  [docs/operations/runbook-backup-restore.md](../operations/runbook-backup-restore.md)
  (procedure documented; automation pending provider).

## Verification

`terraform fmt/validate` runs in `.github/workflows/deploy.yml`; the module
contains no provider-specific resource, so switching providers is additive.
