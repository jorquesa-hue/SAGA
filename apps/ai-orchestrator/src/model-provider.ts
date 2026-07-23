/**
 * Model-provider abstraction (§62). The real LLM provider is an OPEN decision
 * (ADR-008 — ai model providers), so the orchestrator depends only on this
 * interface and ships a DETERMINISTIC rule provider by default: no external
 * model call, fully testable, and safe. When ADR-008 closes, an LLM-backed
 * provider implements the same interface and everything downstream — evidence
 * binding, the policy guard, governance, evals — stays unchanged.
 */

/** A grounded observation produced by a read-only evidence tool. */
export interface Finding {
  kind: string;
  animalId?: string;
  farmId?: string | null;
  summary: string;
  /** Domain event ids that ground this finding (≥1 for a usable proposal). */
  evidenceEventIds: string[];
  severity: "low" | "medium" | "high";
}

/** A proposed recommendation, before governance. */
export interface Draft {
  agentName: string;
  recommendationText: string;
  proposedActionCategory: string;
  confidence: number;
  riskClass: "low" | "medium" | "high";
  evidenceEventIds: string[];
  assumptions?: string;
  proposedAction?: Record<string, unknown>;
}

export interface ModelProvider {
  readonly name: string;
  readonly version: string;
  readonly promptVersion: string;
  propose(findings: Finding[]): Draft[];
}

/**
 * Deterministic, explainable rule provider. Turns findings into SAFE proposals
 * (review/task) only — it never proposes a high-impact or prohibited action;
 * the policy guard enforces this independently as defense-in-depth.
 */
export class DeterministicProvider implements ModelProvider {
  readonly name = "deterministic";
  readonly version = "rules-v1";
  readonly promptVersion = "rules-v1";

  propose(findings: Finding[]): Draft[] {
    return findings
      .filter((f) => f.evidenceEventIds.length > 0)
      .map((f) => this.draftFor(f));
  }

  private draftFor(f: Finding): Draft {
    if (f.kind === "low_weight") {
      return {
        agentName: "Herd Weight Analyst",
        recommendationText: `Revisar ${f.summary} — peso abaixo do esperado; verificar sanidade e nutrição.`,
        proposedActionCategory: "review",
        confidence: f.severity === "high" ? 0.8 : 0.6,
        riskClass: "low",
        evidenceEventIds: f.evidenceEventIds,
        assumptions: "Baseado nas pesagens elegíveis mais recentes.",
        proposedAction: { review: "animal_performance", animalId: f.animalId },
      };
    }
    // missing_weight and any other finding → a weighing task (safe).
    return {
      agentName: "Herd Coverage Analyst",
      recommendationText: `Agendar pesagem: ${f.summary}.`,
      proposedActionCategory: "task",
      confidence: 0.7,
      riskClass: "low",
      evidenceEventIds: f.evidenceEventIds,
      proposedAction: { task: "schedule_weighing", animalId: f.animalId },
    };
  }
}
