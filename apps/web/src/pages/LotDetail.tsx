import { Link, useParams } from "react-router-dom";
import { useClient } from "../session.js";
import { useAsync } from "../use-async.js";
import { Pagination, usePagination } from "../components/Pagination.js";

/** Lot 360: current paddock + members (§20). */
export function LotDetail(): JSX.Element {
  const { id = "" } = useParams();
  const client = useClient();
  const members = useAsync(() => client.lots.members(id), [id]);
  const paddock = useAsync(() => client.lots.currentPaddock(id), [id]);
  const rows = members.data?.items ?? [];
  const paged = usePagination(rows, 25);

  return (
    <section>
      <div className="page-head">
        <h2>
          <Link to="/lots" className="back">
            ← Lotes
          </Link>{" "}
          Lote {id.slice(0, 8)}…
        </h2>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <span className="kpi-label">Piquete atual</span>
          <span className="kpi-value">
            {paddock.loading ? "…" : String(paddock.data?.paddockName ?? paddock.data?.name ?? paddock.data?.paddockId ?? "—")}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Membros ativos</span>
          <span className="kpi-value">{members.loading ? "…" : rows.length}</span>
        </div>
      </div>

      <h3>Membros</h3>
      {members.loading && <p className="muted">Carregando…</p>}
      {members.error && <p className="error">{members.error}</p>}
      {rows.length === 0 && !members.loading && <p className="muted">Nenhum animal no lote.</p>}
      {rows.length > 0 && (
        <>
          <table className="grid">
            <thead>
              <tr>
                <th>Animal</th>
                <th>Situação</th>
                <th>Desde</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((m, i) => {
                const animalId = String(m.animalId ?? m.animal_id ?? "");
                return (
                  <tr key={`${animalId}-${i}`}>
                    <td>{animalId ? <Link to={`/animals/${animalId}`}>{animalId.slice(0, 8)}…</Link> : "—"}</td>
                    <td>{String(m.status ?? "ativo")}</td>
                    <td>{String(m.effectiveAt ?? m.effective_at ?? m.joinedAt ?? "—")}</td>
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
