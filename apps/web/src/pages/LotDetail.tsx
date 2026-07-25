import { Link, useParams } from "react-router-dom";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";
import { Pagination, usePagination } from "../components/Pagination.js";

/** Lot 360: current paddock + members (§20). */
export function LotDetail(): JSX.Element {
  const { id = "" } = useParams();
  const client = useClient();
  const { t, td, fmt } = useI18n();
  const members = useAsync(() => client.lots.members(id), [id]);
  const paddock = useAsync(() => client.lots.currentPaddock(id), [id]);
  const margin = useAsync(() => client.finance.lotMargin(id), [id]);
  const rows = members.data?.items ?? [];
  const money = (v: unknown): string =>
    fmt.currency(v, margin.data?.currency as string | undefined);
  const paged = usePagination(rows, 25);

  return (
    <section>
      <div className="page-head">
        <h2>
          <Link to="/lots" className="back">
            {t("lotDetail.back")}
          </Link>{" "}
          {t("lotDetail.title", { id: id.slice(0, 8) })}
        </h2>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <span className="kpi-label">{t("lotDetail.currentPaddock")}</span>
          <span className="kpi-value">
            {paddock.loading
              ? "…"
              : String(
                  paddock.data?.paddockName ??
                    paddock.data?.name ??
                    paddock.data?.paddockId ??
                    "—",
                )}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("lotDetail.activeMembers")}</span>
          <span className="kpi-value">{members.loading ? "…" : rows.length}</span>
        </div>
      </div>

      {margin.data && (
        <>
          <h3>{t("lotDetail.financials")}</h3>
          <div className="kpi-grid">
            <div className="kpi">
              <span className="kpi-label">{t("lotDetail.revenue")}</span>
              <span className="kpi-value">{money(margin.data.revenue)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t("lotDetail.cost")}</span>
              <span className="kpi-value">{money(margin.data.cost)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t("lotDetail.margin")}</span>
              <span className="kpi-value">{money(margin.data.margin)}</span>
            </div>
          </div>
        </>
      )}

      <h3>{t("lotDetail.members")}</h3>
      {members.loading && <p className="muted">{t("common.loading")}</p>}
      {members.error && <p className="error">{members.error}</p>}
      {rows.length === 0 && !members.loading && (
        <p className="muted">{t("lotDetail.empty")}</p>
      )}
      {rows.length > 0 && (
        <>
          <table className="grid">
            <thead>
              <tr>
                <th>{t("lotDetail.colAnimal")}</th>
                <th>{t("lotDetail.colSituation")}</th>
                <th>{t("lotDetail.colSince")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((m, i) => {
                const animalId = String(m.animalId ?? m.animal_id ?? "");
                return (
                  <tr key={`${animalId}-${i}`}>
                    <td>
                      {animalId ? (
                        <Link to={`/animals/${animalId}`}>{animalId.slice(0, 8)}…</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{td(m.status ?? "active")}</td>
                    <td className="mono">
                      {fmt.date(m.effectiveAt ?? m.effective_at ?? m.joinedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination paged={paged} />
        </>
      )}
    </section>
  );
}
