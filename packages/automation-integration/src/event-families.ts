/**
 * Allowlisted webhook event families (§51). Tenants MAY subscribe only to
 * these families; sensitive contexts (identity/security, AI governance audit,
 * raw device credentials) are intentionally excluded so that a subscription
 * can never exfiltrate access-control or audit internals. Sensitive fields are
 * further minimized per family by the payload projector below.
 */

export const ALLOWED_EVENT_FAMILIES = [
  "animal",
  "weight",
  "health",
  "reproduction",
  "herd",
  "inventory",
  "finance",
  "genetics",
  "pasture",
  "asset",
] as const;

export type EventFamily = (typeof ALLOWED_EVENT_FAMILIES)[number];

const ALLOWED = new Set<string>(ALLOWED_EVENT_FAMILIES);

/** Families that exist as domain contexts but are never webhook-exposable. */
const SENSITIVE_FAMILIES = new Set(["identity", "security", "ai", "connector", "webhook"]);

export function isAllowedFamily(family: string): family is EventFamily {
  return ALLOWED.has(family);
}

export function isSensitiveFamily(family: string): boolean {
  return SENSITIVE_FAMILIES.has(family);
}

/**
 * Map an event type ("<context>.<event>.<version>") to its family. The family
 * is the leading context segment; a few contexts are folded into one family
 * (e.g. lot/movement events belong to "herd").
 */
export function familyOf(eventType: string): string {
  const context = eventType.split(".")[0] ?? "";
  switch (context) {
    case "lot":
    case "movement":
      return "herd";
    case "treatment":
    case "laboratory":
      return "health";
    default:
      return context;
  }
}

/**
 * Minimize a payload to the fields allowed to leave the platform for a family
 * (§51 "sensitive fields minimized by subscription scope"). We publish stable
 * identifiers and non-sensitive descriptors; free-text and internal actor data
 * are dropped. Unknown families fall back to identifier-only projection.
 */
const FAMILY_FIELDS: Record<string, readonly string[]> = {
  animal: ["animalId", "registrationCode", "sex", "breed", "status"],
  weight: ["animalId", "weightKg", "measuredAt", "sessionId"],
  health: ["animalId", "protocolId", "treatmentId", "withdrawalUntil", "status"],
  reproduction: ["animalId", "damId", "sireId", "serviceId", "expectedCalvingDate", "status"],
  herd: ["lotId", "animalId", "paddockId", "fromPaddockId", "toPaddockId", "occurredAt"],
  inventory: ["itemId", "batchId", "quantity", "unit", "movementType"],
  finance: ["transactionId", "lotId", "category", "amountMinor", "currency", "kind"],
  genetics: ["animalId", "indexId", "score", "trait", "value"],
  pasture: ["paddockId", "assessmentId", "coverKgDmHa", "occurredAt"],
  asset: ["assetId", "maintenanceId", "status", "dueAt"],
};

export function projectPayload(family: string, payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = FAMILY_FIELDS[family];
  if (!allowed) {
    // Identifier-only fallback: pass through *Id keys, nothing else.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (k.endsWith("Id") || k === "id") out[k] = v;
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in payload) out[key] = payload[key];
  }
  return out;
}
