import { describe, expect, it } from "vitest";
import {
  DeterministicProvider,
  type Draft,
  type Finding,
} from "../src/model-provider.js";
import { applyPolicy } from "../src/policy.js";

const finding = (over: Partial<Finding> = {}): Finding => ({
  kind: "low_weight",
  animalId: "a-1",
  summary: "animal BR-1 (200 kg)",
  facts: { visualId: "BR-1", weightKg: 200 },
  evidenceEventIds: ["evt-1"],
  severity: "high",
  ...over,
});

describe("DeterministicProvider", () => {
  it("turns a low-weight finding into a safe review proposal with evidence", () => {
    const [draft] = new DeterministicProvider().propose([finding()]);
    expect(draft!.proposedActionCategory).toBe("review");
    expect(draft!.evidenceEventIds).toEqual(["evt-1"]);
    expect(draft!.riskClass).toBe("low");
  });

  it("proposes a task for a coverage gap", () => {
    const [draft] = new DeterministicProvider().propose([
      finding({ kind: "missing_weight", severity: "low" }),
    ]);
    expect(draft!.proposedActionCategory).toBe("task");
  });

  it("flags an active withdrawal as a sale-clearance review (high confidence)", () => {
    const [draft] = new DeterministicProvider().propose([
      finding({ kind: "withdrawal_active", severity: "medium" }),
    ]);
    expect(draft!.proposedActionCategory).toBe("review");
    expect(draft!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(draft!.proposedAction).toMatchObject({ review: "sale_clearance" });
  });

  it("turns a reproduction gap into a breeding-review task", () => {
    const [draft] = new DeterministicProvider().propose([
      finding({ kind: "reproduction_gap", severity: "low" }),
    ]);
    expect(draft!.proposedActionCategory).toBe("task");
    expect(draft!.proposedAction).toMatchObject({ task: "breeding_review" });
  });

  it("never proposes a finding without evidence", () => {
    expect(
      new DeterministicProvider().propose([finding({ evidenceEventIds: [] })]),
    ).toHaveLength(0);
  });

  it("only ever proposes safe action categories", () => {
    const kinds = [
      "low_weight",
      "missing_weight",
      "withdrawal_active",
      "reproduction_gap",
      "unknown",
    ];
    const drafts = new DeterministicProvider().propose(
      kinds.map((k) => finding({ kind: k })),
    );
    for (const d of drafts)
      expect(["review", "task"]).toContain(d.proposedActionCategory);
  });
});

describe("policy guard", () => {
  const base: Draft = {
    agentName: "x",
    recommendationText: "t",
    proposedActionCategory: "review",
    confidence: 0.7,
    riskClass: "low",
    evidenceEventIds: ["evt-1"],
  };

  it("allows a safe, evidence-bound draft", () => {
    const { allowed, blocked } = applyPolicy([base]);
    expect(allowed).toHaveLength(1);
    expect(blocked).toHaveLength(0);
  });

  it("blocks a prohibited action category", () => {
    const { allowed, blocked } = applyPolicy([
      { ...base, proposedActionCategory: "euthanasia" },
    ]);
    expect(allowed).toHaveLength(0);
    expect(blocked[0]!.reason).toBe("prohibited_action_category");
  });

  it("blocks a category that is not on the safe allowlist", () => {
    const { blocked } = applyPolicy([
      { ...base, proposedActionCategory: "operate_equipment" },
    ]);
    expect(blocked[0]!.reason).toBe("prohibited_action_category");
    const { blocked: b2 } = applyPolicy([
      { ...base, proposedActionCategory: "something_new" },
    ]);
    expect(b2[0]!.reason).toBe("category_not_allowlisted");
  });

  it("blocks an evidence-less draft", () => {
    const { blocked } = applyPolicy([{ ...base, evidenceEventIds: [] }]);
    expect(blocked[0]!.reason).toBe("no_evidence");
  });
});

/**
 * docs/brand §2.4 — recommendations are read by operators in three
 * languages, so the provider emits a message key and its facts rather than
 * rendered prose. The prose stays as a fallback for clients that cannot
 * resolve the key and for rows written before migration 0020.
 */
describe("recommendation localisation", () => {
  it("emits a message key and data-only facts, never prose in params", () => {
    const [draft] = new DeterministicProvider().propose([finding()]);
    expect(draft!.recommendationKey).toBe("rec.msg.lowWeight");
    expect(draft!.recommendationParams).toEqual({ visualId: "BR-1", weightKg: 200 });
    for (const value of Object.values(draft!.recommendationParams)) {
      expect(String(value)).not.toMatch(/\s(kg|animal|matriz)\b/i);
    }
  });

  it("picks the dated withdrawal message only when a clearance date is known", () => {
    const withDate = new DeterministicProvider().propose([
      finding({
        kind: "withdrawal_active",
        facts: { visualId: "BR-2", clearedAfter: "2026-03-01" },
      }),
    ]);
    expect(withDate[0]!.recommendationKey).toBe("rec.msg.withdrawalActiveUntil");

    const withoutDate = new DeterministicProvider().propose([
      finding({ kind: "withdrawal_active", facts: { visualId: "BR-2" } }),
    ]);
    expect(withoutDate[0]!.recommendationKey).toBe("rec.msg.withdrawalActive");
  });

  it("still carries rendered text so a client without the key can render", () => {
    const [draft] = new DeterministicProvider().propose([finding()]);
    expect(draft!.recommendationText.length).toBeGreaterThan(0);
  });
});
