import { PlatformError } from "@jk/domain-kernel";

/**
 * AI safety policy (§62). Some proposed-action categories are PROHIBITED from
 * autonomous execution entirely; others are high-impact and remain proposals
 * until a human approves. Recommendations may still be *created* for prohibited
 * actions (as advisory proposals) — they simply can never auto-execute.
 */

/** Categories an agent SHALL NOT execute autonomously (§62). */
export const PROHIBITED_AUTONOMOUS = new Set<string>([
  "diagnose",
  "prescribe",
  "authorize_sale",
  "authorize_purchase",
  "payment",
  "euthanasia",
  "breeding",
  "culling",
  "merge_identity",
  "alter_history",
  "change_access",
  "operate_equipment",
  "send_external",
]);

/** Categories that are safe to auto-execute once approved (low-risk drafts). */
export const SAFE_ACTIONS = new Set<string>(["review", "task", "draft", "summary"]);

export interface ActionAssessment {
  category: string;
  prohibited: boolean;
  highImpact: boolean;
}

export function assessAction(category: string, riskClass: "low" | "medium" | "high"): ActionAssessment {
  const prohibited = PROHIBITED_AUTONOMOUS.has(category);
  const highImpact = prohibited || riskClass === "high" || !SAFE_ACTIONS.has(category);
  return { category, prohibited, highImpact };
}

/** Raised when an agent attempts a prohibited autonomous action (§62). Maps to 403. */
export class ProhibitedAutonomousActionError extends PlatformError {
  readonly code = "JK-AI-PROHIBITED";
  readonly httpStatus = 403;
}

/** Raised when a high-impact action is attempted before human approval. 409. */
export class ApprovalRequiredError extends PlatformError {
  readonly code = "JK-AI-APPROVAL-REQUIRED";
  readonly httpStatus = 409;
}

/** Raised when the AI capability is disabled for the tenant (kill switch). 409. */
export class AiDisabledError extends PlatformError {
  readonly code = "JK-AI-DISABLED";
  readonly httpStatus = 409;
}
