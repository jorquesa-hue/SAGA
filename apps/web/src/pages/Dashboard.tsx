import { useClient } from "../session.js";
import { useAsync } from "../use-async.js";
import { useI18n } from "../i18n/index.js";
import { isFigure, metricLabel } from "../i18n/labels.js";
import { Distribution } from "../components/Distribution.js";

/**
 * Executive dashboard — reads the Farm Intelligence summary (§59, Phase 4).
 * Renders whatever KPI shape the API returns so it stays resilient to
 * contract growth.
 */
export function Dashboard(): JSX.Element {
  const client = useClient();
  const { t, td, fmt } = useI18n();
  const { loading, data, error, reload } = useAsync(
    () => client.analytics.executiveDashboard(),
    [],
  );

  // Render each KPI leaf: arrays → localized count; enums → label; dates/numbers
  // → locale-formatted; anything else → its string.
  const show = (key: string, value: unknown): string => {
    if (key === "farmId" && (value === null || value === undefined)) {
      return t("dashboard.allFarms");
    }
    if (Array.isArray(value))
      return t("dashboard.itemsCount", { n: fmt.number(value.length) });
    const enumLabel = td(value);
    return enumLabel !== String(value ?? "—") ? enumLabel : fmt.auto(value);
  };

  const label = (key: string): string => metricLabel("dashboard.kpi", key, t, td);

  // A distribution is chart-shaped data: as tiles it scatters into one card
  // per category and never shows its shape (docs/brand §3.4). Pull the known
  // ones out and let the rest of the payload keep rendering as tiles.
  const distributions = DISTRIBUTIONS.map((path) => ({
    path,
    values: pick(data as Record<string, unknown> | null, path),
  })).filter((d) => d.values !== null);

  return (
    <section>
      <div className="page-head">
        <h2>{t("dashboard.title")}</h2>
        <button type="button" onClick={reload}>
          {t("dashboard.refresh")}
        </button>
      </div>
      {loading && <p className="muted">{t("dashboard.loading")}</p>}
      {error && <p className="error">{t("dashboard.error", { error })}</p>}
      {data && (
        <div className="kpi-grid">
          {Object.entries(flatten(data, "", DISTRIBUTIONS)).map(([key, value]) => (
            <div className="kpi" key={key}>
              <span className="kpi-label">{label(key)}</span>
              <span
                className={isFigure(value) ? "kpi-value" : "kpi-value kpi-value-text"}
              >
                {show(key, value)}
              </span>
            </div>
          ))}
        </div>
      )}
      {distributions.length > 0 && (
        <div className="dist-grid">
          {distributions.map((d) => (
            <Distribution key={d.path} title={label(d.path)} data={d.values!} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Payload paths that hold a category → count map. These render as charts;
 * everything else stays a tile.
 */
const DISTRIBUTIONS = ["herd.byStatus", "alerts.bySeverity"];

/** Reads a dotted path and returns it only if it is a category → count map. */
function pick(
  source: Record<string, unknown> | null,
  path: string,
): Record<string, number> | null {
  let node: unknown = source;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[part];
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const entries = Object.entries(node as Record<string, unknown>);
  if (entries.length === 0 || !entries.every(([, v]) => typeof v === "number"))
    return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

/** Flatten one nested level so KPI objects render as labelled tiles. */
function flatten(
  obj: Record<string, unknown>,
  prefix = "",
  exclude: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (exclude.includes(key)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key, exclude));
    } else {
      out[key] = v;
    }
  }
  return out;
}
