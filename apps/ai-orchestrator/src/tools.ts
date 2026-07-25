import type { TenantContext } from "@jk/domain-kernel";
import type pg from "pg";
import type { Finding } from "./model-provider.js";

/**
 * Read-only evidence tools (§62). Each returns grounded findings — every
 * finding carries the domain event ids that support it, so recommendations
 * built from them are evidence-bound by construction. Tools run inside a
 * tenant transaction (RLS), so they only ever see the caller's tenant.
 */
export type EvidenceTool = (
  client: pg.PoolClient,
  context: TenantContext,
) => Promise<Finding[]>;

/** Active animals whose latest eligible weight is below a threshold. */
export function lowWeightTool(thresholdKg = 250): EvidenceTool {
  return async (client) => {
    const rows = await client.query<{
      animal_id: string;
      farm_id: string;
      visual_id: string;
      weight_kg: string;
      event_id: string;
    }>(
      `SELECT a.id AS animal_id, a.farm_id, a.visual_id, w.weight_kg, w.event_id
         FROM animal a
         JOIN LATERAL (
           SELECT weight_kg, event_id FROM animal_weight w
            WHERE w.animal_id = a.id AND w.eligible_for_analytics
            ORDER BY occurred_at DESC LIMIT 1
         ) w ON true
        WHERE a.lifecycle_status = 'active' AND w.weight_kg < $1`,
      [thresholdKg],
    );
    return rows.rows.map((r) => ({
      kind: "low_weight",
      animalId: r.animal_id,
      farmId: r.farm_id,
      summary: `animal ${r.visual_id} (${Number(r.weight_kg)} kg)`,
      facts: { visualId: String(r.visual_id), weightKg: Number(r.weight_kg) },
      evidenceEventIds: [r.event_id],
      severity: Number(r.weight_kg) < thresholdKg * 0.8 ? "high" : "medium",
    }));
  };
}

/** Active animals with no weight recorded at all (coverage gap). */
export function missingWeightTool(): EvidenceTool {
  return async (client) => {
    const rows = await client.query<{
      animal_id: string;
      farm_id: string;
      visual_id: string;
      reg_event_id: string | null;
    }>(
      `SELECT a.id AS animal_id, a.farm_id, a.visual_id,
              (SELECT event_id FROM domain_event de
                WHERE de.aggregate_type = 'animal' AND de.aggregate_id = a.id
                ORDER BY occurred_at LIMIT 1) AS reg_event_id
         FROM animal a
        WHERE a.lifecycle_status = 'active'
          AND NOT EXISTS (SELECT 1 FROM animal_weight w WHERE w.animal_id = a.id)`,
    );
    return rows.rows
      .filter((r) => r.reg_event_id) // no grounding event → not a usable finding
      .map((r) => ({
        kind: "missing_weight",
        animalId: r.animal_id,
        farmId: r.farm_id,
        summary: `animal ${r.visual_id} sem pesagem registrada`,
        facts: { visualId: String(r.visual_id) },
        evidenceEventIds: [r.reg_event_id as string],
        severity: "low" as const,
      }));
  };
}

/**
 * Animals under an active medicine-withdrawal restriction — they must not be
 * sold until it lifts (JK-DOM-011). Grounded on the treatment event that
 * created the restriction.
 */
export function withdrawalNearSaleTool(): EvidenceTool {
  return async (client) => {
    const rows = await client.query<{
      animal_id: string;
      farm_id: string;
      visual_id: string;
      event_id: string;
      valid_to: string | null;
    }>(
      `SELECT a.id AS animal_id, a.farm_id, a.visual_id, t.event_id, r.valid_to::text AS valid_to
         FROM animal_restriction r
         JOIN animal a ON a.id = r.animal_id
         JOIN treatment t ON t.id = r.source_treatment_id
        WHERE r.restriction_type = 'withdrawal' AND r.status = 'active' AND t.event_id IS NOT NULL`,
    );
    return rows.rows.map((r) => ({
      kind: "withdrawal_active",
      animalId: r.animal_id,
      farmId: r.farm_id,
      summary: `animal ${r.visual_id}${r.valid_to ? ` (liberado após ${r.valid_to.slice(0, 10)})` : ""}`,
      facts: {
        visualId: String(r.visual_id),
        ...(r.valid_to ? { clearedAfter: r.valid_to.slice(0, 10) } : {}),
      },
      evidenceEventIds: [r.event_id],
      severity: "medium" as const,
    }));
  };
}

/**
 * Active females with no reproduction service ever recorded — a breeding gap
 * to review. Grounded on the animal's registration event.
 */
export function reproductionGapTool(): EvidenceTool {
  return async (client) => {
    const rows = await client.query<{
      animal_id: string;
      farm_id: string;
      visual_id: string;
      reg_event_id: string | null;
    }>(
      `SELECT a.id AS animal_id, a.farm_id, a.visual_id,
              (SELECT event_id FROM domain_event de
                WHERE de.aggregate_type = 'animal' AND de.aggregate_id = a.id
                ORDER BY occurred_at LIMIT 1) AS reg_event_id
         FROM animal a
        WHERE a.lifecycle_status = 'active' AND a.sex = 'female'
          AND NOT EXISTS (SELECT 1 FROM reproduction_service s WHERE s.dam_id = a.id)`,
    );
    return rows.rows
      .filter((r) => r.reg_event_id)
      .map((r) => ({
        kind: "reproduction_gap",
        animalId: r.animal_id,
        farmId: r.farm_id,
        summary: `matriz ${r.visual_id} sem serviço reprodutivo registrado`,
        facts: { visualId: String(r.visual_id) },
        evidenceEventIds: [r.reg_event_id as string],
        severity: "low" as const,
      }));
  };
}

export const DEFAULT_TOOLS: EvidenceTool[] = [
  lowWeightTool(),
  missingWeightTool(),
  withdrawalNearSaleTool(),
  reproductionGapTool(),
];
