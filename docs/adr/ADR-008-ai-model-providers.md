# ADR-008: AI model providers and data residency

- **Status:** OPEN
- **Date:** 2026-07-22 (opened; not yet decided)
- **Deciders:** founder + engineering lead + legal review (pending)
- **Requirement IDs:** JK-CON-005 (explainable AI), JK-CON-006 (human
  control), JK-DOM-012 (approval for high-impact actions), §69 (LGPD),
  Appendix L AI gate
- **Related:** [ADR-001](ADR-001-cloud-provider-and-region.md) (residency),
  [ADR-010](ADR-010-graph-database.md)

## Context

Phase 5 introduces governed AI agents (data steward, analyst) with
evidence-bound recommendations. Which model provider(s) to use (Anthropic,
OpenAI, Google, AWS Bedrock-hosted models, local models), under what data
processing agreement, and where farm data may flow are undecided. The spec
is emphatic: no production farm data reaches any provider before an approved
DPA and security review.

## Decision

OPEN. **Default until decided (spec §93, verbatim):** *"Provider
abstraction; no production farm data until approved DPA/security review."*

The repository honors the default today:

- `.env.example` ships `AI_ENABLED=false` and `AI_PROVIDER=disabled` — the
  configuration contract (Appendix G) makes "off" the typed default.
- No AI orchestrator exists yet (`apps/ai-orchestrator` is a Phase 5
  artifact per Appendix F); no provider SDK is in any `package.json`.

**Decision criteria:**

1. Signed DPA covering farm operational data; LGPD-compatible residency and
   retention (§69).
2. Security review of the provider (sub-processor register entry, §69).
3. Evaluation quality on domain tasks with golden datasets (Appendix L AI
   gate: "Golden evaluation thresholds pass").
4. Cost and latency envelope; kill-switch and audit integration (JK-CON-006,
   §68 "AI approval" audit action).
5. Provider abstraction so models are swappable without domain changes.

## Consequences

Blocked until this closes:

- `apps/ai-orchestrator` provider wiring (the orchestrator skeleton itself
  can be built provider-abstract in Phase 5).
- Any use of real tenant data in evaluations — synthetic fazenda data only
  (repo rule: pt-BR-flavored synthetic sample data, e.g. Brangus reference
  herd seed).

## Verification

`AI_ENABLED`/`AI_PROVIDER` defaults in `.env.example`; absence of provider
SDKs in the lockfile; Phase 5 gate in
[docs/traceability/matrix.md](../traceability/matrix.md) (JK-DOM-012 marked
planned).
