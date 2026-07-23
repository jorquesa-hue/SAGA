import type { TenantContext } from "@jk/domain-kernel";
import type pg from "pg";
import type { Finding } from "./model-provider.js";

/**
 * Read-only evidence tools (§62). Each returns grounded findings — every
 * finding carries the domain event ids that support it, so recommendations
 * built from them are evidence-bound by construction. Tools run inside a
 * tenant transaction (RLS), so they only ever see the caller's tenant.
 */
export type EvidenceTool = (client: pg.PoolClient, context: TenantContext) => Promise<Finding[]>;

/** Active animals whose latest eligible weight is below a threshold. */
export function lowWeightTool(thresholdKg = 250): EvidenceTool {
  return async (client) => {
    const rows = await client.query<{ animal_id: string; farm_id: string; visual_id: string; weight_kg: string; event_id: string }>(
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
      evidenceEventIds: [r.event_id],
      severity: Number(r.weight_kg) < thresholdKg * 0.8 ? "high" : "medium",
    }));
  };
}

/** Active animals with no weight recorded at all (coverage gap). */
export function missingWeightTool(): EvidenceTool {
  return async (client) => {
    const rows = await client.query<{ animal_id: string; farm_id: string; visual_id: string; reg_event_id: string | null }>(
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
        evidenceEventIds: [r.reg_event_id as string],
        severity: "low" as const,
      }));
  };
}

export const DEFAULT_TOOLS: EvidenceTool[] = [lowWeightTool(), missingWeightTool()];
