import type { RecommendationService } from "@jk/analytics-intelligence";
import { withTenantTransaction } from "@jk/database";
import type { TenantContext } from "@jk/domain-kernel";
import type pg from "pg";
import { DeterministicProvider, type Finding, type ModelProvider } from "./model-provider.js";
import { applyPolicy } from "./policy.js";
import { DEFAULT_TOOLS, type EvidenceTool } from "./tools.js";

export interface OrchestratorReport {
  findings: number;
  proposed: number;
  blockedByPolicy: Array<{ category: string; reason: string }>;
  created: string[]; // recommendation ids
}

export interface OrchestratorOptions {
  appPool: pg.Pool;
  recommendations: RecommendationService;
  provider?: ModelProvider;
  tools?: EvidenceTool[];
  environment?: string;
}

/**
 * Governed AI orchestrator (§62). For a tenant: gather grounded evidence with
 * read-only tools, ask the model provider for proposals, run them through the
 * policy guard (prohibited/non-allowlisted/evidence-less drafts are blocked),
 * and record the survivors as governed recommendations — evidence-bound, with
 * confidence and provenance, pending human approval. The recommendation
 * service independently enforces the kill switch and the prohibited-action
 * block, so a misbehaving provider can never produce an autonomous action.
 */
export class Orchestrator {
  private readonly appPool: pg.Pool;
  private readonly recommendations: RecommendationService;
  private readonly provider: ModelProvider;
  private readonly tools: EvidenceTool[];

  constructor(options: OrchestratorOptions) {
    this.appPool = options.appPool;
    this.recommendations = options.recommendations;
    this.provider = options.provider ?? new DeterministicProvider();
    this.tools = options.tools ?? DEFAULT_TOOLS;
  }

  async analyzeTenant(context: TenantContext): Promise<OrchestratorReport> {
    // 1. Gather grounded evidence (read-only, one RLS transaction).
    const findings = await withTenantTransaction(this.appPool, context, async (client) => {
      const all: Finding[] = [];
      for (const tool of this.tools) all.push(...(await tool(client, context)));
      return all;
    });

    // 2. Provider proposes; 3. policy guard filters.
    const drafts = this.provider.propose(findings);
    const { allowed, blocked } = applyPolicy(drafts);

    // 4. Record survivors as governed recommendations (service enforces the
    //    kill switch + prohibited block independently).
    const created: string[] = [];
    for (const draft of allowed) {
      const rec = await this.recommendations.createRecommendation(context, {
        agentName: draft.agentName,
        modelProvider: this.provider.name,
        modelVersion: this.provider.version,
        promptVersion: this.provider.promptVersion,
        recommendationText: draft.recommendationText,
        proposedActionCategory: draft.proposedActionCategory,
        proposedAction: draft.proposedAction ?? {},
        evidenceEventIds: draft.evidenceEventIds,
        confidence: draft.confidence,
        assumptions: draft.assumptions,
        riskClass: draft.riskClass,
      });
      created.push(rec.id);
    }

    return {
      findings: findings.length,
      proposed: drafts.length,
      blockedByPolicy: blocked.map((b) => ({ category: b.draft.proposedActionCategory, reason: b.reason })),
      created,
    };
  }
}
