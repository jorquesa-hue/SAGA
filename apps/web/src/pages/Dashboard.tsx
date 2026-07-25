import { useClient } from "../session.js";
import { useAsync } from "../use-async.js";
import { useI18n } from "../i18n/index.js";

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

  /**
   * A rancher reads these tiles, so they carry names rather than the API's
   * key paths (docs/brand §2.3). The dashboard still renders whatever shape
   * the API returns, so resolution degrades in steps instead of failing:
   * an exact translation, then a translated group with the enum leaf
   * appended, then a humanised key.
   */
  const label = (key: string): string => {
    const exact = t(`dashboard.kpi.${key}`);
    if (exact !== `dashboard.kpi.${key}`) return exact;

    // Dynamic groups keyed by an enum: herd.byStatus.active, alerts.bySeverity.high.
    const lastDot = key.lastIndexOf(".");
    if (lastDot > 0) {
      const group = key.slice(0, lastDot);
      const groupLabel = t(`dashboard.kpi.${group}`);
      if (groupLabel !== `dashboard.kpi.${group}`) {
        return `${groupLabel} · ${td(key.slice(lastDot + 1))}`;
      }
    }
    return humanize(key);
  };

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
          {Object.entries(flatten(data)).map(([key, value]) => (
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
    </section>
  );
}

/**
 * docs/brand §3.3 reserves the monospace face for figures — identifiers,
 * weights, currency and dates — so prose like "all farms" is set in the body
 * face instead of being forced into a numeric column.
 */
function isFigure(value: unknown): boolean {
  if (typeof value === "number") return true;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * Last-resort label for a KPI the catalogue does not know yet:
 * `nutrition.openOrders` → `Nutrition · open orders`. Readable enough to ship
 * while the translation is added, and never a bare key path.
 */
function humanize(key: string): string {
  return key
    .split(".")
    .map((part, i) => {
      const words = part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
      return i === 0 ? words.charAt(0).toUpperCase() + words.slice(1) : words;
    })
    .join(" · ");
}

/** Flatten one nested level so KPI objects render as labelled tiles. */
function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}
