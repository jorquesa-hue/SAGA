import { RecommendationService, AiDisabledError } from "@jk/analytics-intelligence";
import { createTenantContext, newUuid, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Orchestrator } from "../../src/orchestrator.js";
import type { Draft, Finding, ModelProvider } from "../../src/model-provider.js";

const available = databaseAvailable();

function agentContext(tenantId: Uuid): TenantContext {
  return createTenantContext({
    tenantId,
    actor: { type: "agent", id: newUuid(), display: "ai-orchestrator" },
    correlationId: newUuid(),
  });
}

/** A rogue provider that proposes a prohibited action — the guard must stop it. */
class RogueProvider implements ModelProvider {
  readonly name = "rogue";
  readonly version = "v0";
  readonly promptVersion = "v0";
  propose(findings: Finding[]): Draft[] {
    return findings.map((f) => ({
      agentName: "rogue",
      recommendationText: "euthanize immediately",
      proposedActionCategory: "euthanasia",
      confidence: 0.99,
      riskClass: "high",
      evidenceEventIds: f.evidenceEventIds,
    }));
  }
}

describe.skipIf(!available)("Orchestrator (integration)", () => {
  let db: TestDatabase;
  let identity: ReturnType<typeof makeIdentityService>;
  let recommendations: RecommendationService;
  let owner: TenantContext;
  let tenantId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_orchestrator");
    identity = makeIdentityService(db);
    recommendations = new RecommendationService({ appPool: db.appPool, environment: "test", aiEnabled: true });
    const seeded = await seedTenantWithOwner(identity, "Fazenda IA", "owner@example.com");
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    // One active, underweight animal with a grounding weight event.
    const animalId = newUuid();
    await db.adminPool.query(
      `INSERT INTO animal (id, tenant_id, farm_id, visual_id, sex, breed_code, version) VALUES ($1,$2,$3,'BR-LOW','female','BRANGUS',0)`,
      [animalId, tenantId, farm.id],
    );
    await db.adminPool.query(
      `INSERT INTO animal_weight (tenant_id, animal_id, occurred_at, weight_kg, eligible_for_analytics, event_id)
       VALUES ($1,$2, now(), 200, true, 'evt-low-1')`,
      [tenantId, animalId],
    );
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("creates an evidence-bound, safe recommendation from grounded findings", async () => {
    const orchestrator = new Orchestrator({ appPool: db.appPool, recommendations, environment: "test" });
    const report = await orchestrator.analyzeTenant(agentContext(tenantId));
    expect(report.findings).toBeGreaterThanOrEqual(1);
    expect(report.created.length).toBeGreaterThanOrEqual(1);

    const recs = await recommendations.listRecommendations(owner, "pending");
    const review = recs.find((r) => r.proposedActionCategory === "review");
    expect(review).toBeDefined();
    expect(review!.prohibited).toBe(false);
    expect(review!.evidenceEventIds).toContain("evt-low-1");
  });

  it("blocks a rogue provider's prohibited proposal — nothing prohibited is ever created", async () => {
    const orchestrator = new Orchestrator({ appPool: db.appPool, recommendations, provider: new RogueProvider(), environment: "test" });
    const report = await orchestrator.analyzeTenant(agentContext(tenantId));
    expect(report.created).toHaveLength(0);
    expect(report.blockedByPolicy.some((b) => b.category === "euthanasia" && b.reason === "prohibited_action_category")).toBe(true);

    const all = await recommendations.listRecommendations(owner);
    expect(all.some((r) => r.proposedActionCategory === "euthanasia")).toBe(false);
  });

  it("honors the kill switch end-to-end (AI disabled → no recommendation written)", async () => {
    const disabled = new RecommendationService({ appPool: db.appPool, environment: "test", aiEnabled: false });
    const orchestrator = new Orchestrator({ appPool: db.appPool, recommendations: disabled, environment: "test" });
    await expect(orchestrator.analyzeTenant(agentContext(tenantId))).rejects.toBeInstanceOf(AiDisabledError);
  });
});

describe.skipIf(available)("Orchestrator (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
