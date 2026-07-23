import { useState } from "react";
import { ApiError } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useAsync } from "../use-async.js";

/** Operational alert queue (§26): acknowledge and resolve, evidence-linked. */
export function Alerts(): JSX.Element {
  const client = useClient();
  const { loading, data, error, reload } = useAsync(() => client.alerts.list(), []);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(id);
    try {
      await fn();
      reload();
    } catch (e) {
      if (e instanceof ApiError) alert(`${e.code}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>Alertas</h2>
        <button type="button" onClick={reload}>
          Atualizar
        </button>
      </div>
      {loading && <p className="muted">Carregando…</p>}
      {error && <p className="error">{error}</p>}
      {data && data.items.length === 0 && <p className="muted">Nenhum alerta ativo.</p>}
      {data && data.items.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Severidade</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => {
              const id = String(a.id ?? a.alertId ?? "");
              const status = String(a.status ?? "open");
              return (
                <tr key={id}>
                  <td>{String(a.alertType ?? a.type ?? "—")}</td>
                  <td>
                    <span className={`badge risk-${String(a.severity ?? "low")}`}>{String(a.severity ?? "—")}</span>
                  </td>
                  <td>{status}</td>
                  <td>
                    <button type="button" disabled={busy === id || status !== "open"} onClick={() => void act(id, () => client.alerts.acknowledge(id))}>
                      Reconhecer
                    </button>{" "}
                    <button type="button" disabled={busy === id || status === "resolved"} onClick={() => void act(id, () => client.alerts.resolve(id))}>
                      Resolver
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
