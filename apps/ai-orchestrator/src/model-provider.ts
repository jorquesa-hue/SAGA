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
  /**
   * The facts behind the summary, as data rather than prose. The client
   * composes the sentence in the reader's language from these
   * (docs/brand §2.4), so they must never contain rendered text.
   */
  facts: Record<string, string | number>;
  /** Domain event ids that ground this finding (≥1 for a usable proposal). */
  evidenceEventIds: string[];
  severity: "low" | "medium" | "high";
}

/** A proposed recommendation, before governance. */
export interface Draft {
  agentName: string;
  /**
   * Rendered fallback, kept so a client that cannot resolve the key (or a row
   * written before migration 0020) still has something to show.
   */
  recommendationText: string;
  /** Message catalogue key the client renders in the reader's locale. */
  recommendationKey: string;
  /** Facts interpolated into the key. Data only, never prose. */
  recommendationParams: Record<string, string | number>;
  /** Message key for the assumptions line, when there is one. */
  assumptionsKey?: string;
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
    switch (f.kind) {
      case "low_weight":
        return {
          agentName: "Herd Weight Analyst",
          recommendationText: `Revisar ${f.summary} — peso abaixo do esperado; verificar sanidade e nutrição.`,
          recommendationKey: "rec.msg.lowWeight",
          recommendationParams: f.facts ?? {},
          assumptionsKey: "rec.assume.recentWeights",
          proposedActionCategory: "review",
          confidence: f.severity === "high" ? 0.8 : 0.6,
          riskClass: "low",
          evidenceEventIds: f.evidenceEventIds,
          assumptions: "Baseado nas pesagens elegíveis mais recentes.",
          proposedAction: { review: "animal_performance", animalId: f.animalId },
        };
      case "withdrawal_active":
        return {
          agentName: "Sanitary Compliance Analyst",
          recommendationText: `Não vender ${f.summary} — carência de medicamento ativa; conferir liberação antes de qualquer venda.`,
          recommendationKey: f.facts?.clearedAfter
            ? "rec.msg.withdrawalActiveUntil"
            : "rec.msg.withdrawalActive",
          recommendationParams: f.facts ?? {},
          assumptionsKey: "rec.assume.withdrawalRestriction",
          proposedActionCategory: "review",
          confidence: 0.9,
          riskClass: "low",
          evidenceEventIds: f.evidenceEventIds,
          assumptions: "Restrição de carência ativa vinculada a um tratamento.",
          proposedAction: { review: "sale_clearance", animalId: f.animalId },
        };
      case "reproduction_gap":
        return {
          agentName: "Reproduction Analyst",
          recommendationText: `Avaliar aptidão reprodutiva e agendar cobertura: ${f.summary}.`,
          recommendationKey: "rec.msg.reproductionGap",
          recommendationParams: f.facts ?? {},
          proposedActionCategory: "task",
          confidence: 0.6,
          riskClass: "low",
          evidenceEventIds: f.evidenceEventIds,
          proposedAction: { task: "breeding_review", animalId: f.animalId },
        };
      case "missing_weight":
      default:
        return {
          agentName: "Herd Coverage Analyst",
          recommendationText: `Agendar pesagem: ${f.summary}.`,
          recommendationKey: "rec.msg.missingWeight",
          recommendationParams: f.facts ?? {},
          proposedActionCategory: "task",
          confidence: 0.7,
          riskClass: "low",
          evidenceEventIds: f.evidenceEventIds,
          proposedAction: { task: "schedule_weighing", animalId: f.animalId },
        };
    }
  }
}
