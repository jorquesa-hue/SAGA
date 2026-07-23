import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useAsync } from "../use-async.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";
import { Pagination, usePagination } from "../components/Pagination.js";

/**
 * Animal registry: register new animals, filter the list (visual ID / RFID /
 * status — client-side over the loaded set), open the 360 view, and export a
 * traceability packet (JK-ANI-006).
 */
export function Animals(): JSX.Element {
  const client = useClient();
  const { loading, data, error, reload } = useAsync(() => client.animals.list(), []);
  const [exportState, setExportState] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [showForm, setShowForm] = useState(false);

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const q = query.trim().toLowerCase();
    return items.filter((a) => {
      const matchesStatus = status === "all" || (a.lifecycleStatus ?? "active") === status;
      const matchesQuery = !q || (a.visualId ?? "").toLowerCase().includes(q) || a.id.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [data, query, status]);

  const paged = usePagination(filtered, 20);

  const exportPacket = async (animalId: string): Promise<void> => {
    setExportState((s) => ({ ...s, [animalId]: "Gerando…" }));
    try {
      const job = await client.exports.request({ exportType: "animal_traceability_packet", format: "json", params: { animalId } });
      const processed = await client.exports.process(job.id);
      setExportState((s) => ({
        ...s,
        [animalId]: processed.status === "completed" ? `Pronto — ${processed.resolvableUrl}` : `Status: ${processed.status}`,
      }));
    } catch (e) {
      setExportState((s) => ({ ...s, [animalId]: `Falha: ${e instanceof ApiError ? e.code : "erro"}` }));
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>Animais</h2>
        <button type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Fechar" : "Registrar animal"}
        </button>
      </div>

      {showForm && <RegisterForm onDone={() => { setShowForm(false); reload(); }} />}

      <div className="inline-form">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por ID visual…" style={{ minWidth: 220 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Todos os status</option>
          <option value="active">Ativo</option>
          <option value="sold">Vendido</option>
          <option value="deceased">Óbito</option>
          <option value="quarantined">Quarentena</option>
        </select>
        <span className="muted">{filtered.length} de {data?.items.length ?? 0}</span>
      </div>

      {loading && <p className="muted">Carregando…</p>}
      {error && <p className="error">{error}</p>}
      {data && filtered.length === 0 && <p className="muted">Nenhum animal encontrado.</p>}
      {filtered.length > 0 && (
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
            {paged.pageItems.map((a) => (
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
      <Pagination paged={paged} />
    </section>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }): JSX.Element {
  const client = useClient();
  const cmd = useCommand();
  const [farmId, setFarmId] = useState("");
  const [visualId, setVisualId] = useState("");
  const [sex, setSex] = useState("female");
  const [breedCode, setBreedCode] = useState("BRANGUS");
  const [birthDate, setBirthDate] = useState("");
  const [rfid, setRfid] = useState("");

  const submit = (): void => {
    void cmd.run(
      () =>
        client.animals.register({
          farmId,
          visualId,
          sex,
          breedCode,
          ...(birthDate ? { birthDate } : {}),
          ...(rfid ? { rfid } : {}),
        }),
      "Animal registrado",
    );
  };

  return (
    <div className="form">
      <h3>Registrar animal</h3>
      <Field label="Fazenda ID" value={farmId} onChange={setFarmId} placeholder="farm uuid" />
      <Field label="ID visual" value={visualId} onChange={setVisualId} placeholder="ex.: BR-0100" />
      <SelectField
        label="Sexo"
        value={sex}
        onChange={setSex}
        options={[
          { value: "female", label: "Fêmea" },
          { value: "male", label: "Macho" },
          { value: "unknown", label: "Desconhecido" },
        ]}
      />
      <Field label="Raça" value={breedCode} onChange={setBreedCode} />
      <Field label="Nascimento (YYYY-MM-DD, opcional)" value={birthDate} onChange={setBirthDate} />
      <Field label="RFID (opcional)" value={rfid} onChange={setRfid} />
      <div className="card-actions">
        <button type="button" disabled={cmd.busy || !farmId || !visualId} onClick={submit}>
          Registrar
        </button>
        <button type="button" onClick={onDone}>
          Concluir
        </button>
      </div>
      <FormMessage state={cmd} />
    </div>
  );
}
