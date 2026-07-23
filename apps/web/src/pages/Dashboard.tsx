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
  const { loading, data, error, reload } = useAsync(() => client.analytics.executiveDashboard(), []);

  // Render each KPI leaf: arrays → localized count; enums → label; dates/numbers
  // → locale-formatted; anything else → its string.
  const show = (value: unknown): string => {
    if (Array.isArray(value)) return t("dashboard.itemsCount", { n: fmt.number(value.length) });
    const enumLabel = td(value);
    return enumLabel !== String(value ?? "—") ? enumLabel : fmt.auto(value);
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
              <span className="kpi-label">{key}</span>
              <span className="kpi-value">{show(value)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
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
