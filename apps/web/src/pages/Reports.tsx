import { useMemo, useState } from "react";
import {
  ApiError,
  type ReportCatalogItem,
  type ReportColumn,
  type ReportPreviewResult,
} from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";
import type { TranslateFn, TranslateDataFn, Formatters } from "../i18n/index.js";

const CATEGORY_ORDER = [
  "herd",
  "performance",
  "health",
  "reproduction",
  "pasture",
  "inventory",
  "finance",
];

/**
 * Reports (§26). A catalogue of parameterised operational reports over the
 * farm's authoritative records. Pick a report, adjust its filters, and view it;
 * the same result can be committed as an append-only snapshot (recorded in the
 * run ledger) and downloaded as CSV.
 */
export function Reports(): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const catalog = useAsync(() => client.reporting.reports(), []);
  const [selected, setSelected] = useState<ReportCatalogItem | null>(null);

  const grouped = useMemo(() => {
    const items = catalog.data?.items ?? [];
    const byCat = new Map<string, ReportCatalogItem[]>();
    for (const it of items) {
      const list = byCat.get(it.category) ?? [];
      list.push(it);
      byCat.set(it.category, list);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      reports: byCat.get(c)!,
    }));
  }, [catalog.data]);

  return (
    <section>
      <div className="page-head">
        <h2>{t("reporting.title")}</h2>
      </div>
      <p className="muted">{t("reporting.subtitle")}</p>

      {catalog.loading && <p className="muted">{t("common.loading")}</p>}
      {catalog.error && <p className="error">{catalog.error}</p>}

      <div className="reports-layout">
        <nav className="reports-catalog">
          {grouped.map((g) => (
            <div key={g.category} className="reports-cat">
              <h3>{t(`reporting.cat.${g.category}`)}</h3>
              {g.reports.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={
                    selected?.key === r.key ? "report-pick on" : "report-pick"
                  }
                  onClick={() => setSelected(r)}
                >
                  {t(r.titleKey)}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="reports-panel">
          {selected ? (
            <ReportRunner key={selected.key} report={selected} />
          ) : (
            <p className="muted">{t("reporting.pick")}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ReportRunner({ report }: { report: ReportCatalogItem }): JSX.Element {
  const client = useClient();
  const { t, td, fmt } = useI18n();
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ReportPreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const runs = useAsync(() => client.reporting.runs(report.key), [report.key]);

  const cleanParams = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) if (v) out[k] = v;
    return out;
  };

  const view = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setResult(await client.reporting.preview(report.key, cleanParams()));
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await client.reporting.run(report.key, { params: cleanParams() });
      setNotice(t("reporting.saved"));
      runs.reload();
    } catch (err) {
      // A read-only demo answers writes with 501 — say so plainly.
      setNotice(
        err instanceof ApiError && err.status === 501
          ? t("reporting.readOnly")
          : errText(err, t),
      );
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setResult(await client.reporting.run_get(id));
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h3>{t(report.titleKey)}</h3>
      </div>
      <p className="muted">{t(report.descriptionKey)}</p>

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void view();
        }}
      >
        {report.params.map((p) => (
          <label key={p.key} className="report-param">
            <span className="report-param-label">{t(p.labelKey)}</span>
            <input
              type={p.kind === "dateFrom" || p.kind === "dateTo" ? "date" : "text"}
              value={params[p.key] ?? ""}
              placeholder={p.kind === "farmId" || p.kind === "lotId" ? "UUID" : ""}
              onChange={(e) =>
                setParams((prev) => ({ ...prev, [p.key]: e.target.value }))
              }
            />
          </label>
        ))}
        <button type="submit" disabled={busy}>
          {t("reporting.view")}
        </button>
        {result && (
          <>
            <button type="button" onClick={() => void save()} disabled={busy}>
              {t("reporting.save")}
            </button>
            <button
              type="button"
              className="button-link"
              onClick={() => downloadCsv(report, result)}
            >
              {t("reporting.download")}
            </button>
          </>
        )}
      </form>

      {error && <p className="error">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      {result && (
        <>
          <ReportSummary summary={result.summary} t={t} fmt={fmt} />
          <ReportTable
            columns={result.columns}
            rows={result.rows}
            t={t}
            td={td}
            fmt={fmt}
          />
        </>
      )}

      <div className="reports-runs">
        <h4>{t("reporting.recent")}</h4>
        {runs.data && runs.data.items.length === 0 && (
          <p className="muted">{t("reporting.recentEmpty")}</p>
        )}
        {runs.data && runs.data.items.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <th>{t("reporting.summary")}</th>
                <th className="num">{t("reporting.rows", { n: "" }).trim()}</th>
                <th>{t("reporting.reopen")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.items.map((run) => (
                <tr key={run.id}>
                  <td className="mono">{fmt.dateTime(run.generatedAt)}</td>
                  <td className="num mono">{fmt.number(run.rowCount)}</td>
                  <td>
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => void reopen(run.id)}
                    >
                      {t("reporting.reopen")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ReportSummary({
  summary,
  t,
  fmt,
}: {
  summary: Record<string, unknown>;
  t: TranslateFn;
  fmt: Formatters;
}): JSX.Element | null {
  const entries = Object.entries(summary).filter(
    ([, v]) => v !== null && v !== undefined && typeof v !== "object",
  );
  if (entries.length === 0) return null;
  return (
    <div className="report-summary">
      {entries.map(([k, v]) => (
        <div key={k} className="report-stat">
          <span className="report-stat-label">{t(`reporting.sum.${k}`)}</span>
          <span className="report-stat-value">{summaryValue(k, v, fmt)}</span>
        </div>
      ))}
    </div>
  );
}

function ReportTable({
  columns,
  rows,
  t,
  td,
  fmt,
}: {
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  t: TranslateFn;
  td: TranslateDataFn;
  fmt: Formatters;
}): JSX.Element {
  if (rows.length === 0) return <p className="muted">{t("reporting.noRows")}</p>;
  return (
    <>
      <p className="muted">{t("reporting.rows", { n: rows.length })}</p>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={isFigure(c) ? "num" : undefined}>
                  {t(c.labelKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={isFigure(c) ? "num mono" : undefined}
                  >
                    {cell(c, row[c.key], td, fmt)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function isFigure(c: ReportColumn): boolean {
  return (
    c.type === "number" ||
    c.type === "integer" ||
    c.type === "money" ||
    c.type === "percent"
  );
}

function cell(c: ReportColumn, value: unknown, td: TranslateDataFn, fmt: Formatters): string {
  if (value === null || value === undefined) return "—";
  switch (c.type) {
    case "money":
      return fmt.currency(Number(value) / 100);
    case "number":
    case "integer":
      return fmt.number(value);
    case "percent":
      return `${fmt.number(Number(value) * 100)}%`;
    case "date":
      return fmt.date(value);
    case "datetime":
      return fmt.dateTime(value);
    case "enum":
      return td(value);
    default:
      return String(value);
  }
}

function summaryValue(key: string, value: unknown, fmt: Formatters): string {
  if (key.endsWith("Minor")) return fmt.currency(Number(value) / 100);
  if (key === "pregnancyRate")
    return value === null ? "—" : `${fmt.number(Number(value) * 100)}%`;
  if (key === "currency") return String(value);
  if (typeof value === "number") return fmt.number(value);
  return String(value);
}

function errText(err: unknown, t: TranslateFn): string {
  return err instanceof ApiError
    ? `${err.code}: ${err.message}`
    : t("common.unexpectedError");
}

/** Serialise the currently viewed result to CSV and trigger a browser download
 * — pure client-side, so it works even against the read-only demo. */
function downloadCsv(report: ReportCatalogItem, result: ReportPreviewResult): void {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = result.columns.map((c) => c.key).join(",");
  const lines = [header];
  for (const row of result.rows) {
    lines.push(result.columns.map((c) => esc(row[c.key])).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${report.key}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
