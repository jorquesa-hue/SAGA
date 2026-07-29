import type pg from "pg";

/**
 * The report catalogue (§26 mandatory reports, §59 dashboards).
 *
 * Each definition is declarative: a stable key, a category, i18n label keys
 * for its title/description/columns, the parameters it accepts, the shape of
 * its columns, and a `run` that projects the answer from authoritative records
 * inside an already tenant-scoped transaction (RLS is enforced by the caller;
 * definitions never set the tenant themselves). Every report discloses a
 * summary so a result is interpretable without re-deriving it, and every
 * figure is projected from records — nothing is stored pre-aggregated.
 *
 * Adding a report is adding one entry here plus its i18n keys; the API, the
 * run ledger, and the console surface it automatically.
 */

export type ReportColumnType =
  "text" | "integer" | "number" | "money" | "percent" | "date" | "datetime" | "enum";

export interface ReportColumn {
  key: string;
  /** i18n key resolved by the console; falls back to the key itself. */
  labelKey: string;
  type: ReportColumnType;
}

/** The kinds of parameter a report accepts. All are optional by design so a
 * report always runs (an absent filter means "everything"). */
export type ReportParamKind = "farmId" | "lotId" | "dateFrom" | "dateTo";

export interface ReportParamSpec {
  key: string;
  kind: ReportParamKind;
  labelKey: string;
}

export type ReportCategory =
  | "herd"
  | "performance"
  | "health"
  | "reproduction"
  | "pasture"
  | "inventory"
  | "finance";

export interface ReportOutput {
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
}

export interface ReportDefinition {
  key: string;
  category: ReportCategory;
  titleKey: string;
  descriptionKey: string;
  params: ReportParamSpec[];
  columns: ReportColumn[];
  run(client: pg.PoolClient, params: NormalizedParams): Promise<ReportOutput>;
}

/** Parameters after coercion: uuids or ISO timestamps, or null when absent. */
export interface NormalizedParams {
  farmId: string | null;
  lotId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const round = (v: number, dp = 2): number => Math.round(v * 10 ** dp) / 10 ** dp;

const FARM_PARAM: ReportParamSpec = {
  key: "farmId",
  kind: "farmId",
  labelKey: "reporting.param.farmId",
};
const FROM_PARAM: ReportParamSpec = {
  key: "dateFrom",
  kind: "dateFrom",
  labelKey: "reporting.param.dateFrom",
};
const TO_PARAM: ReportParamSpec = {
  key: "dateTo",
  kind: "dateTo",
  labelKey: "reporting.param.dateTo",
};

// ---------------------------------------------------------------------------
// Herd — animal inventory (§19)
// ---------------------------------------------------------------------------
const herdInventory: ReportDefinition = {
  key: "herd.inventory",
  category: "herd",
  titleKey: "reporting.report.herd.inventory.title",
  descriptionKey: "reporting.report.herd.inventory.desc",
  params: [FARM_PARAM],
  columns: [
    { key: "visualId", labelKey: "reporting.col.visualId", type: "text" },
    { key: "sex", labelKey: "reporting.col.sex", type: "enum" },
    { key: "breedCode", labelKey: "reporting.col.breed", type: "text" },
    { key: "lifecycleStatus", labelKey: "reporting.col.status", type: "enum" },
    { key: "birthDate", labelKey: "reporting.col.birthDate", type: "date" },
  ],
  async run(client, params) {
    const result = await client.query(
      `SELECT visual_id, sex, breed_code, lifecycle_status, birth_date
         FROM animal
        WHERE ($1::uuid IS NULL OR farm_id = $1)
        ORDER BY visual_id`,
      [params.farmId],
    );
    const byStatus: Record<string, number> = {};
    const bySex: Record<string, number> = {};
    for (const r of result.rows) {
      byStatus[r.lifecycle_status] = (byStatus[r.lifecycle_status] ?? 0) + 1;
      bySex[r.sex] = (bySex[r.sex] ?? 0) + 1;
    }
    return {
      rows: result.rows.map((r) => ({
        visualId: r.visual_id,
        sex: r.sex,
        breedCode: r.breed_code,
        lifecycleStatus: r.lifecycle_status,
        birthDate: r.birth_date,
      })),
      summary: { total: result.rows.length, byStatus, bySex },
    };
  },
};

// ---------------------------------------------------------------------------
// Performance — per-animal weight gain / ADG (§21, §26)
// ---------------------------------------------------------------------------
const performanceWeightGain: ReportDefinition = {
  key: "performance.weightGain",
  category: "performance",
  titleKey: "reporting.report.performance.weightGain.title",
  descriptionKey: "reporting.report.performance.weightGain.desc",
  params: [FARM_PARAM],
  columns: [
    { key: "visualId", labelKey: "reporting.col.visualId", type: "text" },
    { key: "firstWeightKg", labelKey: "reporting.col.firstWeight", type: "number" },
    { key: "latestWeightKg", labelKey: "reporting.col.latestWeight", type: "number" },
    { key: "adgKgPerDay", labelKey: "reporting.col.adg", type: "number" },
    { key: "daysOnTest", labelKey: "reporting.col.days", type: "integer" },
  ],
  async run(client, params) {
    // First and latest analytics-eligible weight per active animal.
    const result = await client.query(
      `SELECT a.visual_id,
              fw.weight_kg AS first_kg, fw.occurred_at AS first_at,
              lw.weight_kg AS latest_kg, lw.occurred_at AS latest_at
         FROM animal a
         LEFT JOIN LATERAL (
           SELECT weight_kg, occurred_at FROM animal_weight w
            WHERE w.animal_id = a.id AND w.eligible_for_analytics = true
            ORDER BY occurred_at ASC LIMIT 1
         ) fw ON true
         LEFT JOIN LATERAL (
           SELECT weight_kg, occurred_at FROM animal_weight w
            WHERE w.animal_id = a.id AND w.eligible_for_analytics = true
            ORDER BY occurred_at DESC LIMIT 1
         ) lw ON true
        WHERE a.lifecycle_status = 'active'
          AND ($1::uuid IS NULL OR a.farm_id = $1)
        ORDER BY a.visual_id`,
      [params.farmId],
    );
    let adgSum = 0;
    let adgCount = 0;
    let totalGainKg = 0;
    const rows = result.rows.map((r) => {
      const first = num(r.first_kg);
      const latest = num(r.latest_kg);
      let adg: number | null = null;
      let days: number | null = null;
      if (
        first !== null &&
        latest !== null &&
        r.first_at &&
        r.latest_at &&
        new Date(r.latest_at).getTime() > new Date(r.first_at).getTime()
      ) {
        days = Math.round(
          (new Date(r.latest_at).getTime() - new Date(r.first_at).getTime()) / 86_400_000,
        );
        if (days > 0) {
          adg = round((latest - first) / days, 3);
          adgSum += adg;
          adgCount += 1;
          totalGainKg += latest - first;
        }
      }
      return {
        visualId: r.visual_id,
        firstWeightKg: first,
        latestWeightKg: latest,
        adgKgPerDay: adg,
        daysOnTest: days,
      };
    });
    return {
      rows,
      summary: {
        animals: rows.length,
        animalsWithTwoWeights: adgCount,
        avgAdgKgPerDay: adgCount > 0 ? round(adgSum / adgCount, 3) : null,
        totalGainKg: round(totalGainKg),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Health — active withdrawal restrictions blocking sale (carência) (§22)
// ---------------------------------------------------------------------------
const healthWithdrawal: ReportDefinition = {
  key: "health.withdrawal",
  category: "health",
  titleKey: "reporting.report.health.withdrawal.title",
  descriptionKey: "reporting.report.health.withdrawal.desc",
  params: [FARM_PARAM],
  columns: [
    { key: "visualId", labelKey: "reporting.col.visualId", type: "text" },
    { key: "restrictionType", labelKey: "reporting.col.restriction", type: "enum" },
    { key: "reason", labelKey: "reporting.col.reason", type: "text" },
    { key: "validFrom", labelKey: "reporting.col.since", type: "datetime" },
    { key: "validTo", labelKey: "reporting.col.until", type: "datetime" },
  ],
  async run(client, params) {
    const result = await client.query(
      `SELECT a.visual_id, r.restriction_type, r.reason, r.valid_from, r.valid_to
         FROM animal_restriction r
         JOIN animal a ON a.id = r.animal_id
        WHERE r.status = 'active'
          AND r.restriction_type = 'withdrawal'
          AND (r.valid_to IS NULL OR r.valid_to > now())
          AND ($1::uuid IS NULL OR a.farm_id = $1)
        ORDER BY r.valid_to NULLS LAST, a.visual_id`,
      [params.farmId],
    );
    const animalsBlocked = new Set(result.rows.map((r) => r.visual_id)).size;
    return {
      rows: result.rows.map((r) => ({
        visualId: r.visual_id,
        restrictionType: r.restriction_type,
        reason: r.reason,
        validFrom: r.valid_from,
        validTo: r.valid_to,
      })),
      summary: { activeRestrictions: result.rows.length, animalsBlocked },
    };
  },
};

// ---------------------------------------------------------------------------
// Reproduction — services and their pregnancy outcome over a period (§24)
// ---------------------------------------------------------------------------
const reproductionPerformance: ReportDefinition = {
  key: "reproduction.performance",
  category: "reproduction",
  titleKey: "reporting.report.reproduction.performance.title",
  descriptionKey: "reporting.report.reproduction.performance.desc",
  params: [FROM_PARAM, TO_PARAM],
  columns: [
    { key: "visualId", labelKey: "reporting.col.dam", type: "text" },
    { key: "method", labelKey: "reporting.col.method", type: "enum" },
    { key: "serviceDate", labelKey: "reporting.col.serviceDate", type: "date" },
    { key: "checkResult", labelKey: "reporting.col.checkResult", type: "enum" },
  ],
  async run(client, params) {
    const result = await client.query(
      `SELECT a.visual_id, s.method, s.service_date,
              (SELECT pc.result FROM pregnancy_check pc
                 WHERE pc.service_id = s.id ORDER BY pc.check_date DESC LIMIT 1) AS check_result
         FROM reproduction_service s
         JOIN animal a ON a.id = s.dam_id
        WHERE ($1::timestamptz IS NULL OR s.service_date >= $1)
          AND ($2::timestamptz IS NULL OR s.service_date <= $2)
        ORDER BY s.service_date DESC`,
      [params.dateFrom, params.dateTo],
    );
    const services = result.rows.length;
    const positives = result.rows.filter((r) => r.check_result === "positive").length;
    const checked = result.rows.filter((r) => r.check_result !== null).length;
    const calvings = await client.query<{ c: string; live: string }>(
      `SELECT count(*)::int AS c,
              count(*) FILTER (WHERE outcome = 'live')::int AS live
         FROM calving
        WHERE ($1::timestamptz IS NULL OR calving_date >= $1)
          AND ($2::timestamptz IS NULL OR calving_date <= $2)`,
      [params.dateFrom, params.dateTo],
    );
    return {
      rows: result.rows.map((r) => ({
        visualId: r.visual_id,
        method: r.method,
        serviceDate: r.service_date,
        checkResult: r.check_result,
      })),
      summary: {
        services,
        checked,
        positives,
        pregnancyRate: checked > 0 ? round(positives / checked, 3) : null,
        calvings: Number(calvings.rows[0]?.c ?? 0),
        liveCalves: Number(calvings.rows[0]?.live ?? 0),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Pasture — current occupation and stocking rate (§20)
// ---------------------------------------------------------------------------
const pastureOccupation: ReportDefinition = {
  key: "pasture.occupation",
  category: "pasture",
  titleKey: "reporting.report.pasture.occupation.title",
  descriptionKey: "reporting.report.pasture.occupation.desc",
  params: [],
  columns: [
    { key: "paddock", labelKey: "reporting.col.paddock", type: "text" },
    { key: "lot", labelKey: "reporting.col.lot", type: "text" },
    { key: "headCount", labelKey: "reporting.col.head", type: "integer" },
    { key: "areaHa", labelKey: "reporting.col.area", type: "number" },
    { key: "stockingPerHa", labelKey: "reporting.col.stocking", type: "number" },
    { key: "entryAt", labelKey: "reporting.col.since", type: "date" },
  ],
  async run(client) {
    const result = await client.query(
      `SELECT p.name AS paddock, l.name AS lot, o.head_count, p.area_ha, o.entry_at
         FROM paddock_occupation o
         JOIN paddock p ON p.id = o.paddock_id
         JOIN lot l ON l.id = o.lot_id
        WHERE o.exit_at IS NULL
        ORDER BY p.name`,
    );
    let totalHead = 0;
    let totalArea = 0;
    const rows = result.rows.map((r) => {
      const head = num(r.head_count);
      const area = num(r.area_ha);
      if (head !== null) totalHead += head;
      if (area !== null) totalArea += area;
      return {
        paddock: r.paddock,
        lot: r.lot,
        headCount: head,
        areaHa: area === null ? null : round(area),
        stockingPerHa:
          head !== null && area !== null && area > 0 ? round(head / area) : null,
        entryAt: r.entry_at,
      };
    });
    return {
      rows,
      summary: {
        occupiedPaddocks: rows.length,
        totalHead,
        totalAreaHa: round(totalArea),
        avgStockingPerHa: totalArea > 0 ? round(totalHead / totalArea) : null,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Inventory — current stock balance by item, from the ledger (§25)
// ---------------------------------------------------------------------------
const inventoryStock: ReportDefinition = {
  key: "inventory.stock",
  category: "inventory",
  titleKey: "reporting.report.inventory.stock.title",
  descriptionKey: "reporting.report.inventory.stock.desc",
  params: [],
  columns: [
    { key: "name", labelKey: "reporting.col.item", type: "text" },
    { key: "category", labelKey: "reporting.col.category", type: "enum" },
    { key: "unit", labelKey: "reporting.col.unit", type: "text" },
    { key: "balance", labelKey: "reporting.col.balance", type: "number" },
    { key: "reorderLevel", labelKey: "reporting.col.reorder", type: "number" },
  ],
  async run(client) {
    const result = await client.query(
      `SELECT i.name, i.category, i.unit, i.reorder_level,
              COALESCE(SUM(m.quantity_delta), 0) AS balance
         FROM item i
         LEFT JOIN stock_movement m ON m.item_id = i.id
        GROUP BY i.id, i.name, i.category, i.unit, i.reorder_level
        ORDER BY i.name`,
    );
    let belowReorder = 0;
    const rows = result.rows.map((r) => {
      const balance = round(num(r.balance) ?? 0);
      const reorder = num(r.reorder_level);
      if (reorder !== null && balance < reorder) belowReorder += 1;
      return {
        name: r.name,
        category: r.category,
        unit: r.unit,
        balance,
        reorderLevel: reorder,
      };
    });
    return { rows, summary: { items: rows.length, belowReorder } };
  },
};

// ---------------------------------------------------------------------------
// Finance — profit & loss by category over a period (§55, §26)
// ---------------------------------------------------------------------------
const financePl: ReportDefinition = {
  key: "finance.pl",
  category: "finance",
  titleKey: "reporting.report.finance.pl.title",
  descriptionKey: "reporting.report.finance.pl.desc",
  params: [FROM_PARAM, TO_PARAM],
  columns: [
    { key: "entryType", labelKey: "reporting.col.entryType", type: "enum" },
    { key: "category", labelKey: "reporting.col.category", type: "enum" },
    { key: "totalMinor", labelKey: "reporting.col.total", type: "money" },
  ],
  async run(client, params) {
    const result = await client.query(
      `SELECT entry_type, category, SUM(amount_minor)::bigint AS total_minor, count(*)::int AS entries
         FROM financial_entry
        WHERE ($1::timestamptz IS NULL OR occurred_at >= $1)
          AND ($2::timestamptz IS NULL OR occurred_at <= $2)
        GROUP BY entry_type, category
        ORDER BY entry_type, total_minor DESC`,
      [params.dateFrom, params.dateTo],
    );
    let revenue = 0;
    let expense = 0;
    for (const r of result.rows) {
      const total = Number(r.total_minor);
      if (r.entry_type === "revenue") revenue += total;
      else expense += total;
    }
    return {
      rows: result.rows.map((r) => ({
        entryType: r.entry_type,
        category: r.category,
        totalMinor: Number(r.total_minor),
      })),
      summary: {
        currency: "BRL",
        totalRevenueMinor: revenue,
        totalExpenseMinor: expense,
        marginMinor: revenue - expense,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Finance — the financial ledger over a period (§55)
// ---------------------------------------------------------------------------
const financeLedger: ReportDefinition = {
  key: "finance.ledger",
  category: "finance",
  titleKey: "reporting.report.finance.ledger.title",
  descriptionKey: "reporting.report.finance.ledger.desc",
  params: [FROM_PARAM, TO_PARAM],
  columns: [
    { key: "occurredAt", labelKey: "reporting.col.date", type: "date" },
    { key: "entryType", labelKey: "reporting.col.entryType", type: "enum" },
    { key: "category", labelKey: "reporting.col.category", type: "enum" },
    { key: "counterparty", labelKey: "reporting.col.counterparty", type: "text" },
    { key: "amountMinor", labelKey: "reporting.col.amount", type: "money" },
  ],
  async run(client, params) {
    const result = await client.query(
      `SELECT occurred_at, entry_type, category, counterparty, amount_minor, currency
         FROM financial_entry
        WHERE ($1::timestamptz IS NULL OR occurred_at >= $1)
          AND ($2::timestamptz IS NULL OR occurred_at <= $2)
        ORDER BY occurred_at DESC`,
      [params.dateFrom, params.dateTo],
    );
    let revenue = 0;
    let expense = 0;
    for (const r of result.rows) {
      const total = Number(r.amount_minor);
      if (r.entry_type === "revenue") revenue += total;
      else expense += total;
    }
    return {
      rows: result.rows.map((r) => ({
        occurredAt: r.occurred_at,
        entryType: r.entry_type,
        category: r.category,
        counterparty: r.counterparty,
        amountMinor: Number(r.amount_minor),
      })),
      summary: {
        currency: "BRL",
        entries: result.rows.length,
        totalRevenueMinor: revenue,
        totalExpenseMinor: expense,
        marginMinor: revenue - expense,
      },
    };
  },
};

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  herdInventory,
  performanceWeightGain,
  healthWithdrawal,
  reproductionPerformance,
  pastureOccupation,
  inventoryStock,
  financePl,
  financeLedger,
];

const BY_KEY = new Map(REPORT_DEFINITIONS.map((d) => [d.key, d]));

export function findReport(key: string): ReportDefinition | undefined {
  return BY_KEY.get(key);
}
