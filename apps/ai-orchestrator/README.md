# @jk/ai-orchestrator

Governed AI orchestrator (§62). Per tenant it gathers grounded evidence with
read-only tools, asks a **model provider** for proposals, runs them through a
**policy guard**, and records the survivors as **governed recommendations** —
evidence-bound, with confidence and provenance, pending human approval.

## Why it's safe by construction

- **Evidence-bound**: every finding carries the domain event ids that support
  it; a proposal with no evidence is dropped.
- **Policy guard** (defense-in-depth): the orchestrator refuses to even
  *propose* anything outside the safe-action allowlist — a prohibited or
  non-allowlisted category is blocked and reported, never created.
- **Governed writes**: recommendations are created through the Phase 5
  recommendation service, which independently enforces the kill switch, the
  prohibited-autonomous-action block, and the human-approval requirement. A
  misbehaving provider therefore *cannot* produce an autonomous action.
- **Kill switch**: `AI_ENABLED` defaults off; with it off the orchestrator does
  no work and no recommendation is written.

## Model provider — ADR-008 (open)

The real LLM provider is an **open decision (ADR-008)**, so the orchestrator
depends only on a `ModelProvider` interface and ships a **deterministic rule
provider** by default (no external model call, fully testable). When ADR-008
closes, an LLM-backed provider implements the same interface and everything
downstream — evidence binding, the guard, governance, evals — is unchanged.

## Pieces

- `tools.ts` — read-only evidence collectors (RLS-scoped): low-weight animals,
  weighing-coverage gaps. Each finding cites grounding event ids.
- `model-provider.ts` — `ModelProvider` interface + `DeterministicProvider`.
- `policy.ts` — the guard (`applyPolicy`) over the safe-action allowlist.
- `orchestrator.ts` — `analyzeTenant`: tools → propose → guard → govern.
- `main.ts` — per-tenant analysis loop, health, and a `POST /analyze/:tenantId`
  manual trigger (`:4300`).

## Tests (evals)

```bash
pnpm --filter @jk/ai-orchestrator test:unit          # provider + policy guard
TEST_DATABASE_ADMIN_URL=... pnpm --filter @jk/ai-orchestrator test:integration
```

The integration suite is the safety eval: a grounded finding yields an
evidence-bound *review* recommendation; a **rogue provider proposing euthanasia
is blocked and nothing prohibited is ever written**; and the kill switch stops
generation end-to-end.
