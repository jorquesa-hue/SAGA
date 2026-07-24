import {
  createEventEnvelope,
  newUuid,
  NotFoundError,
  ValidationError,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import { appendEvent, withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { z } from "zod";
import {
  assessAction,
  AiDisabledError,
  ApprovalRequiredError,
  ProhibitedAutonomousActionError,
} from "./ai-safety.js";
import { decide, loadCallerMemberships } from "./authorization.js";
import { AnalyticsForbiddenError } from "./errors.js";

/**
 * Governed AI recommendation service (§61-§64, JK-CON-005/006, JK-DOM-012).
 * Every recommendation is evidence-bound and carries model/provider/prompt
 * version, confidence, assumptions, and risk. High-impact actions remain
 * proposals until a human approves; prohibited categories can never
 * auto-execute. Every step is audited; a kill switch disables generation.
 */

export const RECOMMENDATION_CREATED = "ai.recommendation_created.v1";

const APPROVER_ROLES = new Set([
  "tenant_owner",
  "farm_manager",
  "veterinarian",
  "genetics_specialist",
  "finance_user",
]);

export const createRecommendationInputSchema = z
  .object({
    agentName: z.string().min(1).max(120),
    modelProvider: z.string().min(1).max(120),
    modelVersion: z.string().min(1).max(120),
    promptVersion: z.string().min(1).max(120),
    recommendationText: z.string().min(1).max(4000),
    proposedActionCategory: z.string().min(1).max(60),
    proposedAction: z.record(z.unknown()).default({}),
    evidenceEventIds: z
      .array(z.string())
      .min(1, "a recommendation must cite at least one evidence event"),
    confidence: z.number().min(0).max(1),
    assumptions: z.string().max(2000).optional(),
    riskClass: z.enum(["low", "medium", "high"]),
    farmId: z.string().uuid().optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type CreateRecommendationInput = z.input<typeof createRecommendationInputSchema>;

export interface Recommendation {
  id: Uuid;
  agentName: string;
  recommendationText: string;
  proposedActionCategory: string;
  confidence: number;
  riskClass: string;
  status: string;
  prohibited: boolean;
  highImpact: boolean;
  evidenceEventIds: string[];
}

export interface RecommendationServiceOptions {
  appPool: pg.Pool;
  environment?: string;
  /** Kill switch (§62/§64). When false, no recommendations may be generated. */
  aiEnabled?: boolean;
}

export class RecommendationService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;
  private readonly aiEnabled: boolean;

  constructor(options: RecommendationServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
    this.aiEnabled = options.aiEnabled ?? true;
  }

  /** Create an evidence-bound recommendation (proposal). Requires evidence,
   *  confidence, and model/prompt version (§62). Never auto-executes. */
  async createRecommendation(
    context: TenantContext,
    rawInput: CreateRecommendationInput,
  ): Promise<Recommendation> {
    if (!this.aiEnabled) {
      throw new AiDisabledError(
        "AI recommendation generation is disabled for this tenant (kill switch)",
      );
    }
    const input = this.parse(createRecommendationInputSchema, rawInput);
    const assessment = assessAction(input.proposedActionCategory, input.riskClass);
    return this.authorizedWrite(context, async (client) => {
      const id = newUuid();
      const append = await appendEvent(
        client,
        createEventEnvelope({
          eventType: RECOMMENDATION_CREATED,
          context,
          aggregateType: "recommendation",
          aggregateId: id,
          aggregateVersion: 1,
          source: { channel: "system" },
          idempotencyKey: input.idempotencyKey ?? `rec-${id}`,
          payload: {
            recommendationId: id,
            agentName: input.agentName,
            category: input.proposedActionCategory,
          },
        }),
        { environment: this.environment },
      );
      await client.query(
        `INSERT INTO recommendation
           (id, tenant_id, farm_id, agent_name, model_provider, model_version, prompt_version,
            recommendation_text, proposed_action_category, proposed_action, evidence_event_ids,
            confidence, assumptions, risk_class, status, expires_at, event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending',$15,$16)`,
        [
          id,
          context.tenantId,
          input.farmId ?? null,
          input.agentName,
          input.modelProvider,
          input.modelVersion,
          input.promptVersion,
          input.recommendationText,
          input.proposedActionCategory,
          JSON.stringify(input.proposedAction),
          input.evidenceEventIds,
          input.confidence,
          input.assumptions ?? null,
          input.riskClass,
          input.expiresAt ?? null,
          append.eventId,
        ],
      );
      await this.audit(client, context, id, input.agentName, "created", "created", {
        category: input.proposedActionCategory,
        prohibited: assessment.prohibited,
        confidence: input.confidence,
      });
      return this.toDto(id, input, assessment, "pending");
    });
  }

  /** Human approval of a recommendation (JK-CON-006). Records approver + audit. */
  async approveRecommendation(context: TenantContext, id: Uuid): Promise<void> {
    await this.authorizedApprove(context, async (client) => {
      const rec = await this.load(client, id);
      if (rec.status !== "pending")
        throw new ValidationError(`Recommendation ${id} is not pending`);
      await client.query(
        `UPDATE recommendation SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`,
        [id, context.actor.type === "user" ? context.actor.id : null],
      );
      await this.audit(client, context, id, rec.agent_name, "approve", "approved", {});
    });
  }

  async rejectRecommendation(
    context: TenantContext,
    id: Uuid,
    reason: string,
  ): Promise<void> {
    await this.authorizedApprove(context, async (client) => {
      const rec = await this.load(client, id);
      if (rec.status !== "pending")
        throw new ValidationError(`Recommendation ${id} is not pending`);
      await client.query(
        `UPDATE recommendation SET status = 'rejected', rejected_reason = $2 WHERE id = $1`,
        [id, reason],
      );
      await this.audit(client, context, id, rec.agent_name, "reject", "rejected", {
        reason,
      });
    });
  }

  /**
   * Attempt to autonomously execute a recommendation's action (agent path).
   * PROHIBITED categories are always blocked (§62, scenario #12). High-impact
   * actions require prior human approval. Only approved, safe actions execute.
   */
  async attemptAutonomousExecution(
    context: TenantContext,
    id: Uuid,
  ): Promise<{ executed: boolean }> {
    // The block/execute decision AND its audit must persist even when the
    // attempt is rejected, so the transaction commits and the error is thrown
    // afterwards (a rolled-back block audit would be no audit at all, §62/§68).
    const outcome = await this.authorizedWrite(context, async (client) => {
      const rec = await this.load(client, id);
      const assessment = assessAction(rec.proposed_action_category, rec.risk_class);

      if (assessment.prohibited) {
        await this.audit(
          client,
          context,
          id,
          rec.agent_name,
          "attempt_autonomous",
          "blocked",
          {
            reason: "prohibited_autonomous_action",
            category: rec.proposed_action_category,
          },
        );
        return { kind: "prohibited" as const, category: rec.proposed_action_category };
      }
      if (rec.status !== "approved") {
        await this.audit(
          client,
          context,
          id,
          rec.agent_name,
          "attempt_autonomous",
          "blocked",
          {
            reason: "approval_required",
          },
        );
        return { kind: "approval_required" as const };
      }
      await client.query(`UPDATE recommendation SET status = 'executed' WHERE id = $1`, [
        id,
      ]);
      await this.audit(client, context, id, rec.agent_name, "execute", "executed", {});
      return { kind: "executed" as const };
    });

    if (outcome.kind === "prohibited") {
      throw new ProhibitedAutonomousActionError(
        `Action '${outcome.category}' is prohibited from autonomous execution; a human must perform it`,
      );
    }
    if (outcome.kind === "approval_required") {
      throw new ApprovalRequiredError(
        `Recommendation ${id} requires human approval before execution`,
      );
    }
    return { executed: true };
  }

  async getRecommendation(
    context: TenantContext,
    id: Uuid,
  ): Promise<Recommendation & { evidenceEventIds: string[] }> {
    return this.read(context, async (client) => {
      const rec = await this.load(client, id);
      const assessment = assessAction(rec.proposed_action_category, rec.risk_class);
      return {
        id: rec.id,
        agentName: rec.agent_name,
        recommendationText: rec.recommendation_text,
        proposedActionCategory: rec.proposed_action_category,
        confidence: Number(rec.confidence),
        riskClass: rec.risk_class,
        status: rec.status,
        prohibited: assessment.prohibited,
        highImpact: assessment.highImpact,
        evidenceEventIds: rec.evidence_event_ids,
      };
    });
  }

  async listRecommendations(
    context: TenantContext,
    status?: string,
  ): Promise<Recommendation[]> {
    return this.read(context, async (client) => {
      const result = await client.query<RecommendationRow>(
        `SELECT * FROM recommendation WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC`,
        [status ?? null],
      );
      return result.rows.map((rec) => {
        const a = assessAction(rec.proposed_action_category, rec.risk_class);
        return {
          id: rec.id,
          agentName: rec.agent_name,
          recommendationText: rec.recommendation_text,
          proposedActionCategory: rec.proposed_action_category,
          confidence: Number(rec.confidence),
          riskClass: rec.risk_class,
          status: rec.status,
          prohibited: a.prohibited,
          highImpact: a.highImpact,
          evidenceEventIds: rec.evidence_event_ids,
        };
      });
    });
  }

  // -- internals --
  private toDto(
    id: string,
    input: z.infer<typeof createRecommendationInputSchema>,
    a: { prohibited: boolean; highImpact: boolean },
    status: string,
  ): Recommendation {
    return {
      id,
      agentName: input.agentName,
      recommendationText: input.recommendationText,
      proposedActionCategory: input.proposedActionCategory,
      confidence: input.confidence,
      riskClass: input.riskClass,
      status,
      prohibited: a.prohibited,
      highImpact: a.highImpact,
      evidenceEventIds: input.evidenceEventIds,
    };
  }

  private async load(client: pg.PoolClient, id: string): Promise<RecommendationRow> {
    const result = await client.query<RecommendationRow>(
      `SELECT * FROM recommendation WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0)
      throw new NotFoundError(`Recommendation ${id} not found`);
    return result.rows[0]!;
  }

  private async audit(
    client: pg.PoolClient,
    context: TenantContext,
    recommendationId: string,
    agentName: string | null,
    action: string,
    outcome: "created" | "approved" | "rejected" | "executed" | "blocked",
    detail: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ai_action_audit (tenant_id, recommendation_id, agent_name, action, outcome, detail, actor_type, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        context.tenantId,
        recommendationId,
        agentName,
        action,
        outcome,
        JSON.stringify(detail),
        context.actor.type,
        context.actor.id,
      ],
    );
  }

  private parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(
        "Invalid input",
        result.error.issues.map((i) => ({ field: i.path.join("."), reason: i.message })),
      );
    }
    return result.data;
  }

  private async authorizedWrite<T>(
    context: TenantContext,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    // Agents (service actors) and members may generate/attempt; approval is separate.
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      if (context.actor.type === "service" || context.actor.type === "agent") {
        return { ok: true as const, value: await fn(client) };
      }
      const memberships = await loadCallerMemberships(client, context);
      if (memberships.filter((m) => m.status === "active").length === 0) {
        return { ok: false as const, reason: "no_active_membership" };
      }
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new AnalyticsForbiddenError(outcome.reason);
    return outcome.value;
  }

  private async authorizedApprove<T>(
    context: TenantContext,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const active = memberships.filter((m) => m.status === "active");
      if (active.length === 0)
        return { ok: false as const, reason: "no_active_membership" };
      // Human approval only: an agent/service may not approve its own proposals.
      if (
        context.actor.type !== "user" ||
        !active.some((m) => APPROVER_ROLES.has(m.role))
      ) {
        return {
          ok: false as const,
          reason: "human approval requires an authorized management role",
        };
      }
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new AnalyticsForbiddenError(outcome.reason);
    return outcome.value;
  }

  private async read<T>(
    context: TenantContext,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide("read", context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok)
      throw new AnalyticsForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}

interface RecommendationRow {
  id: string;
  agent_name: string;
  recommendation_text: string;
  proposed_action_category: string;
  confidence: string;
  risk_class: "low" | "medium" | "high";
  status: string;
  evidence_event_ids: string[];
}
