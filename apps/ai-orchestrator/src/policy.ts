import { PROHIBITED_AUTONOMOUS, SAFE_ACTIONS } from "@jk/analytics-intelligence";
import type { Draft } from "./model-provider.js";

/**
 * Orchestrator policy guard (§62) — defense-in-depth on top of the
 * recommendation service's own block. The orchestrator refuses to even PROPOSE
 * anything outside the safe-action allowlist: a draft is blocked if its
 * category is prohibited, not on the SAFE list, or cites no evidence. Blocked
 * drafts are reported (for audit), never silently dropped and never created.
 */
export interface PolicyResult {
  allowed: Draft[];
  blocked: Array<{ draft: Draft; reason: string }>;
}

export function applyPolicy(drafts: Draft[]): PolicyResult {
  const allowed: Draft[] = [];
  const blocked: Array<{ draft: Draft; reason: string }> = [];
  for (const draft of drafts) {
    if (draft.evidenceEventIds.length === 0) {
      blocked.push({ draft, reason: "no_evidence" });
    } else if (PROHIBITED_AUTONOMOUS.has(draft.proposedActionCategory)) {
      blocked.push({ draft, reason: "prohibited_action_category" });
    } else if (!SAFE_ACTIONS.has(draft.proposedActionCategory)) {
      blocked.push({ draft, reason: "category_not_allowlisted" });
    } else {
      allowed.push(draft);
    }
  }
  return { allowed, blocked };
}
