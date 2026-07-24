# ADR-007: Accounting system integration

- **Status:** OPEN
- **Date:** 2026-07-22 (opened; not yet decided)
- **Deciders:** founder + finance stakeholder (pending)
- **Requirement IDs:** §15.2 (operational finance), §24 (finance/sales),
  §33 (accounting export connector), JK-CON-007 (customer data export),
  JK-FIN-* (Phase 4)
- **Related:** [ADR-009](ADR-009-analytical-warehouse.md)

## Context

Which accounting system the enterprise uses (Brazilian market: e.g. Omie,
Conta Azul, Totvs/Protheus, Dominio, or the accountant's own tooling) is
undecided, and so is the integration depth (file export vs API sync).
JK Platform's finance module (Phase 4) tracks **operational** cost/revenue
and allocations — it is not a general ledger, and the spec keeps fiscal
bookkeeping out of scope for the initial release (§4.2 non-goals).

## Decision

OPEN. **Default until decided (spec §93, verbatim):** _"CSV/journal export
baseline."_

**Decision criteria:**

1. What the enterprise's accountant actually consumes (chart of accounts,
   file layouts, competência vs caixa expectations).
2. API availability, auth model, and rate limits of the chosen system
   (connector contract requirements in §33: authentication, retry,
   idempotency, rate limits, reconciliation, observability, versioning,
   failure modes).
3. Reconciliation workflow: who confirms totals on each side (§87-style
   reconciliation applies to exports too).
4. Legal/fiscal requirements on export retention (§69, §44).

## Consequences

Blocked until this closes:

- Any accounting connector implementation (Phase 4 `packages/finance-commerce`
  per Appendix F — not yet created).
- Journal-export column dictionary (will live in
  `docs/data-dictionary/` when Phase 4 lands).

Not blocked: Phase 4 finance domain modeling proceeds against the CSV/journal
export baseline; `packages/domain-kernel/src/money.ts` already enforces
currency + original amount storage (JK-DOM-008) independent of any
accounting target.

## Verification

When implemented, the export becomes a documented machine-readable format
(JK-CON-007) with a golden-file test; until then this ADR is the visible
blocker.
