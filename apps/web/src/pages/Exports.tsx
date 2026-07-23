import { useState, type FormEvent } from "react";
import { ApiError, type ExportType } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useAsync } from "../use-async.js";

const TYPES: { value: ExportType; label: string; needsAnimal?: boolean }[] = [
  { value: "animal_traceability_packet", label: "Rastreabilidade do animal", needsAnimal: true },
  { value: "animal_inventory", label: "Inventário de animais" },
  { value: "herd_weights", label: "Pesagens do rebanho" },
  { value: "finance_ledger", label: "Razão financeiro" },
];

/** Exports center (§27): request, process, and track secure exports. */
export function Exports(): JSX.Element {
  const client = useClient();
  const jobs = useAsync(() => client.exports.list(), []);
  const [type, setType] = useState<ExportType>("animal_inventory");
  const [animalId, setAnimalId] = useState("");
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [msg, setMsg] = useState<string | null>(null);

  const selected = TYPES.find((t) => t.value === type);

  const request = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setMsg(null);
    try {
      const job = await client.exports.request({
        exportType: type,
        format,
        params: selected?.needsAnimal ? { animalId } : {},
      });
      await client.exports.process(job.id);
      jobs.reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? `${err.code}: ${err.message}` : "erro");
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>Exportações</h2>
        <button type="button" onClick={jobs.reload}>
          Atualizar
        </button>
      </div>

      <form className="inline-form" onSubmit={request}>
        <select value={type} onChange={(e) => setType(e.target.value as ExportType)}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {selected?.needsAnimal && (
          <input value={animalId} onChange={(e) => setAnimalId(e.target.value)} placeholder="animal UUID" style={{ minWidth: 240 }} />
        )}
        <select value={format} onChange={(e) => setFormat(e.target.value as "json" | "csv")}>
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
        <button type="submit" disabled={selected?.needsAnimal && !animalId}>
          Gerar
        </button>
      </form>
      {msg && <p className="error">{msg}</p>}

      {jobs.loading && <p className="muted">Carregando…</p>}
      {jobs.error && <p className="error">{jobs.error}</p>}
      {jobs.data && jobs.data.items.length === 0 && <p className="muted">Nenhuma exportação.</p>}
      {jobs.data && jobs.data.items.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Formato</th>
              <th>Status</th>
              <th>Tamanho</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            {jobs.data.items.map((j) => (
              <tr key={j.id}>
                <td>{j.exportType}</td>
                <td>{j.format}</td>
                <td>{j.status}</td>
                <td>{j.byteSize ? `${j.byteSize} B` : "—"}</td>
                <td>{j.status === "completed" ? <code>{j.resolvableUrl}</code> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
