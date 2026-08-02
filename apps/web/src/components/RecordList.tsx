import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";

/**
 * A titled list of records fetched from the API.
 *
 * Every operational screen answers the same three questions — is it loading,
 * did it fail, is it empty — and every one of them used to answer them
 * slightly differently. Centralising that here means a new screen inherits the
 * loading/error/empty behaviour and the brand's table treatment (docs/brand
 * §3.4: figures in the mono face, one row per fact) instead of reinventing it.
 *
 * `columns` is declarative so a column can render a figure, a badge, or a link
 * without the caller writing table markup.
 */

export interface Column<T> {
  /** Message-catalogue key for the header. Never a literal (docs/brand §2.4). */
  headerKey: string;
  render: (row: T) => ReactNode;
  /** Right-align and set in the mono face — for weights, money, counts. */
  figure?: boolean;
}

export interface RecordListProps<T> {
  titleKey: string;
  /** Fetch the rows. Kept as a thunk so the list owns reloading. */
  load: () => Promise<{ items: T[] }>;
  /** Re-run `load` when any of these change. */
  deps?: unknown[];
  columns: Array<Column<T>>;
  rowKey: (row: T) => string;
  emptyKey?: string;
  /** Rendered between the heading and the table — a summary line, filters. */
  children?: ReactNode;
  /**
   * When set and it returns a path, the whole row becomes a way into that
   * record: it lifts on hover and navigates on click or Enter. A cell should
   * still hold a real link/label for keyboard and screen-reader users; the row
   * click is a convenience over it.
   */
  rowHref?: (row: T) => string | null;
}

export function RecordList<T>({
  titleKey,
  load,
  deps = [],
  columns,
  rowKey,
  emptyKey = "common.empty",
  children,
  rowHref,
}: RecordListProps<T>): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { loading, data, error, reload } = useAsync(load, deps);
  // A payload is network input: treat a missing or malformed `items` as an
  // empty list rather than trusting its shape and crashing the screen.
  const items = Array.isArray(data?.items) ? data.items : null;

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{t(titleKey)}</h3>
        <button type="button" onClick={reload}>
          {t("common.refresh")}
        </button>
      </div>
      {children}
      {loading && <p className="muted">{t("common.loading")}</p>}
      {error && <p className="error">{error}</p>}
      {items !== null && items.length === 0 && <p className="muted">{t(emptyKey)}</p>}
      {items !== null && items.length > 0 && (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.headerKey} className={c.figure ? "num" : undefined}>
                    {t(c.headerKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const href = rowHref?.(row) ?? null;
                return (
                  <tr
                    key={rowKey(row)}
                    className={href ? "row-link" : undefined}
                    onClick={href ? () => navigate(href) : undefined}
                    onKeyDown={
                      href
                        ? (e) => {
                            if (e.key === "Enter") navigate(href);
                          }
                        : undefined
                    }
                  >
                    {columns.map((c) => (
                      <td key={c.headerKey} className={c.figure ? "num mono" : undefined}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
