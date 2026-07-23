import { useMemo, useState } from "react";
import { useI18n } from "../i18n/index.js";

export interface Paged<T> {
  pageItems: T[];
  page: number;
  pageCount: number;
  total: number;
  setPage: (p: number) => void;
  next: () => void;
  prev: () => void;
}

/**
 * Client-side pagination over an already-loaded, filtered list. Resets to the
 * first page whenever the underlying set shrinks below the current page (e.g.
 * after a search narrows results), so the view never lands on an empty page.
 */
export function usePagination<T>(items: T[], pageSize = 20): Paged<T> {
  const [page, setPageRaw] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(page, pageCount);
  const start = (clamped - 1) * pageSize;
  const pageItems = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);

  const setPage = (p: number): void => setPageRaw(Math.min(Math.max(1, p), pageCount));
  return {
    pageItems,
    page: clamped,
    pageCount,
    total: items.length,
    setPage,
    next: () => setPage(clamped + 1),
    prev: () => setPage(clamped - 1),
  };
}

export function Pagination({ paged }: { paged: Paged<unknown> }): JSX.Element | null {
  const { t } = useI18n();
  if (paged.pageCount <= 1) return null;
  return (
    <div className="pagination">
      <button type="button" onClick={paged.prev} disabled={paged.page <= 1}>
        {t("pager.prev")}
      </button>
      <span className="muted">
        {t("pager.status", { page: paged.page, pages: paged.pageCount, total: paged.total })}
      </span>
      <button type="button" onClick={paged.next} disabled={paged.page >= paged.pageCount}>
        {t("pager.next")}
      </button>
    </div>
  );
}
