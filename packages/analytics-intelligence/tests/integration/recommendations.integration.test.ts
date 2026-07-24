import {
  createTenantContext,
  newUuid,
  ValidationError,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  makeTenantContext,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecommendationService } from "../../src/recommendation-service.js";
import {
  AiDisabledError,
  ApprovalRequiredError,
  ProhibitedAutonomousActionError,
} from "../../src/ai-safety.js";
import { AnalyticsForbiddenError } from "../../src/errors.js";

const available = databaseAvailable();

function agentContext(tenantId: Uuid): TenantContext {
  return createTenantContext({
    tenantId,
    actor: { type: "agent", id: newUuid(), display: "Herd Analyst" },
    correlationId: newUuid(),
  });
}

const baseInput = {
  agentName: "Herd Analyst",
  modelProvider: "anthropic",
  modelVersion: "test-model-1",
  promptVersion: "prompt-v1",
  recommendationText: "Rever 3 animais com ganho abaixo do esperado.",
  proposedActionCategory: "review",
  evidenceEventIds: ["01EVENT000000000000000001"],
  confidence: 0.82,
  riskClass: "low" as const,
};

describe.skipIf(!available)("RecommendationService (integration)", () => {
  let db: TestDatabase;
  let ai: RecommendationService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_ai");
    identity = makeIdentityService(db);
    ai = new RecommendationService({
      appPool: db.appPool,
      environment: "test",
      aiEnabled: true,
    });
    const seeded = await seedTenantWithOwner(identity, "Fazenda IA", "owner@example.com");
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("creates an evidence-bound recommendation (§62)", async () => {
    const rec = await ai.createRecommendation(agentContext(tenantId), baseInput);
    expect(rec.status).toBe("pending");
    expect(rec.evidenceEventIds).toHaveLength(1);
    expect(rec.prohibited).toBe(false);

    const audit = await db.adminPool.query(
      `SELECT count(*)::int AS n FROM ai_action_audit WHERE tenant_id = $1 AND outcome = 'created'`,
      [tenantId],
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it("refuses to create a recommendation with no evidence (§62)", async () => {
    await expect(
      ai.createRecommendation(agentContext(tenantId), {
        ...baseInput,
        evidenceEventIds: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("honors the kill switch (AI disabled) (§64)", async () => {
    const disabled = new RecommendationService({
      appPool: db.appPool,
      environment: "test",
      aiEnabled: false,
    });
    await expect(
      disabled.createRecommendation(agentContext(tenantId), baseInput),
    ).rejects.toBeInstanceOf(AiDisabledError);
  });

  it("BLOCKS a prohibited autonomous action and audits it (scenario #12, §62)", async () => {
    // An agent proposes euthanasia (prohibited) — allowed as a proposal…
    const rec = await ai.createRecommendation(agentContext(tenantId), {
      ...baseInput,
      proposedActionCategory: "euthanasia",
      recommendationText: "Eutanásia sugerida para animal com fratura irreversível.",
      riskClass: "high",
    });
    expect(rec.prohibited).toBe(true);

    // …but attempting to execute it autonomously is blocked.
    await expect(
      ai.attemptAutonomousExecution(agentContext(tenantId), rec.id),
    ).rejects.toBeInstanceOf(ProhibitedAutonomousActionError);

    const blocked = await db.adminPool.query(
      `SELECT detail FROM ai_action_audit WHERE recommendation_id = $1 AND outcome = 'blocked'`,
      [rec.id],
    );
    expect(blocked.rows.length).toBeGreaterThan(0);
    expect(blocked.rows[0].detail.reason).toBe("prohibited_autonomous_action");

    // Even a human cannot make it auto-execute: it stays prohibited.
    await ai.approveRecommendation(owner, rec.id).catch(() => {});
    await expect(
      ai.attemptAutonomousExecution(agentContext(tenantId), rec.id),
    ).rejects.toBeInstanceOf(ProhibitedAutonomousActionError);
  });

  it("requires human approval before executing a non-prohibited action (JK-CON-006)", async () => {
    const rec = await ai.createRecommendation(agentContext(tenantId), {
      ...baseInput,
      proposedActionCategory: "task",
    });
    await expect(
      ai.attemptAutonomousExecution(agentContext(tenantId), rec.id),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);

    await ai.approveRecommendation(owner, rec.id);
    const result = await ai.attemptAutonomousExecution(agentContext(tenantId), rec.id);
    expect(result.executed).toBe(true);

    const final = await ai.getRecommendation(owner, rec.id);
    expect(final.status).toBe("executed");
  });

  it("an agent cannot approve its own proposal (human-in-the-loop)", async () => {
    const rec = await ai.createRecommendation(agentContext(tenantId), {
      ...baseInput,
      proposedActionCategory: "task",
    });
    await expect(
      ai.approveRecommendation(agentContext(tenantId), rec.id),
    ).rejects.toBeInstanceOf(AnalyticsForbiddenError);
  });

  it("denies approval by a non-management role (technician)", async () => {
    const invite = await identity.inviteUser(owner, {
      email: "tec@example.com",
      displayName: "Tec",
      role: "technician",
    });
    await identity.activateMembership(owner, {
      userId: invite.userId,
      role: "technician",
    });
    const tech = makeTenantContext(tenantId, invite.userId);
    const rec = await ai.createRecommendation(agentContext(tenantId), {
      ...baseInput,
      proposedActionCategory: "task",
    });
    await expect(ai.approveRecommendation(tech, rec.id)).rejects.toBeInstanceOf(
      AnalyticsForbiddenError,
    );
  });

  it("does not leak recommendations across tenants", async () => {
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    await expect(ai.listRecommendations(other.ownerContext)).resolves.toEqual([]);
  });
});

describe.skipIf(available)("RecommendationService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
