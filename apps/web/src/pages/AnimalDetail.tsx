import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useAsync } from "../use-async.js";

/**
 * Animal 360 view — identity plus the cross-context history (weights,
 * restrictions, treatments, reproduction) and a one-click traceability export
 * (JK-ANI-006). Each section loads independently and degrades gracefully.
 */
export function AnimalDetail(): JSX.Element {
  const { id = "" } = useParams();
  const client = useClient();
  const animal = useAsync(() => client.animals.get(id), [id]);
  const weights = useAsync(() => client.animals.weights(id), [id]);
  const restrictions = useAsync(() => client.health.restrictions(id), [id]);
  const treatments = useAsync(() => client.health.treatments(id), [id]);
  const repro = useAsync(() => client.reproduction.status(id), [id]);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const exportPacket = async (): Promise<void> => {
    setExportMsg("Gerando…");
    try {
      const job = await client.exports.request({ exportType: "animal_traceability_packet", format: "json", params: { animalId: id } });
      const done = await client.exports.process(job.id);
      setExportMsg(done.status === "completed" ? `Pronto — ${done.resolvableUrl}` : `Status: ${done.status}`);
    } catch (e) {
      setExportMsg(e instanceof ApiError ? `Falha: ${e.code}` : "Falha");
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>
          <Link to="/animals" className="back">
            ← Animais
          </Link>{" "}
          {animal.data?.visualId ?? id.slice(0, 8)}
        </h2>
        <button type="button" onClick={() => void exportPacket()}>
          Exportar rastreabilidade
        </button>
      </div>
      {exportMsg && <p className="hint">{exportMsg}</p>}

      {animal.error && <p className="error">{animal.error}</p>}
      {animal.data && (
        <div className="kpi-grid">
          <Tile label="Sexo" value={animal.data.sex} />
          <Tile label="Raça" value={animal.data.breedCode} />
          <Tile label="Status" value={animal.data.lifecycleStatus} />
        </div>
      )}

      <Section title="Pesagens" state={weights}>
        {(rows) => (
          <table className="grid">
            <thead>
              <tr>
                <th>Data</th>
                <th>Peso (kg)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w, i) => (
                <tr key={i}>
                  <td>{String(w.occurredAt ?? w.occurred_at ?? "—")}</td>
                  <td>{String(w.weightKg ?? w.weight_kg ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Restrições" state={restrictions}>
        {(rows) => (
          <ul className="cards">
            {rows.map((r, i) => (
              <li className="card" key={i}>
                <strong>{String(r.restrictionType ?? r.restriction_type ?? "—")}</strong>
                <p className="muted">{String(r.status ?? "—")}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Tratamentos" state={treatments}>
        {(rows) => (
          <ul className="cards">
            {rows.map((t, i) => (
              <li className="card" key={i}>
                <strong>{String(t.productName ?? t.product_name ?? t.treatmentType ?? "tratamento")}</strong>
                <p className="muted">{String(t.administeredAt ?? t.administered_at ?? "—")}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="page-head" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ margin: 0 }}>Reprodução</h3>
      </div>
      {repro.loading && <p className="muted">Carregando…</p>}
      {repro.error && <p className="muted">Sem dados reprodutivos.</p>}
      {repro.data && (
        <div className="kpi-grid">
          {Object.entries(repro.data).map(([k, v]) => (
            <Tile key={k} label={k} value={v} />
          ))}
        </div>
      )}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: unknown }): JSX.Element {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value === null || value === undefined ? "—" : String(value)}</span>
    </div>
  );
}

interface Loadable<T> {
  loading: boolean;
  error: string | null;
  data: { items: T[] } | null;
}

function Section<T>({
  title,
  state,
  children,
}: {
  title: string;
  state: Loadable<T>;
  children: (rows: T[]) => JSX.Element;
}): JSX.Element {
  return (
    <>
      <div className="page-head" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      {state.loading && <p className="muted">Carregando…</p>}
      {state.error && <p className="muted">Sem registros.</p>}
      {state.data && state.data.items.length === 0 && <p className="muted">Sem registros.</p>}
      {state.data && state.data.items.length > 0 && children(state.data.items)}
    </>
  );
}
