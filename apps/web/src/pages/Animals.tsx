import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useAsync } from "../use-async.js";

/**
 * Animal registry list with one-click traceability packet export
 * (JK-ANI-006): request → process → surface the QR-resolvable download link.
 */
export function Animals(): JSX.Element {
  const client = useClient();
  const { loading, data, error } = useAsync(() => client.animals.list(), []);
  const [exportState, setExportState] = useState<Record<string, string>>({});

  const exportPacket = async (animalId: string): Promise<void> => {
    setExportState((s) => ({ ...s, [animalId]: "Gerando…" }));
    try {
      const job = await client.exports.request({
        exportType: "animal_traceability_packet",
        format: "json",
        params: { animalId },
      });
      const processed = await client.exports.process(job.id);
      setExportState((s) => ({
        ...s,
        [animalId]: processed.status === "completed" ? `Pronto — ${processed.resolvableUrl}` : `Status: ${processed.status}`,
      }));
    } catch (e) {
      const msg = e instanceof ApiError ? e.code : "erro";
      setExportState((s) => ({ ...s, [animalId]: `Falha: ${msg}` }));
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>Animais</h2>
      </div>
      {loading && <p className="muted">Carregando…</p>}
      {error && <p className="error">{error}</p>}
      {data && data.items.length === 0 && <p className="muted">Nenhum animal registrado.</p>}
      {data && data.items.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>ID visual</th>
              <th>Sexo</th>
              <th>Raça</th>
              <th>Status</th>
              <th>Rastreabilidade</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link to={`/animals/${a.id}`}>{a.visualId ?? a.id.slice(0, 8)}</Link>
                </td>
                <td>{a.sex ?? "—"}</td>
                <td>{a.breedCode ?? "—"}</td>
                <td>{a.lifecycleStatus ?? "—"}</td>
                <td>
                  <button type="button" onClick={() => void exportPacket(a.id)}>
                    Exportar
                  </button>
                  {exportState[a.id] && <span className="hint"> {exportState[a.id]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
