import { useState, type FormEvent } from "react";
import { ApiError, type ExportType } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";

const TYPES: { value: ExportType; labelKey: string; needsAnimal?: boolean }[] = [
  {
    value: "animal_traceability_packet",
    labelKey: "exports.typeTrace",
    needsAnimal: true,
  },
  { value: "animal_inventory", labelKey: "exports.typeInventory" },
  { value: "herd_weights", labelKey: "exports.typeWeights" },
  { value: "finance_ledger", labelKey: "exports.typeLedger" },
];

/** Exports center (§27): request, process, and track secure exports. */
export function Exports(): JSX.Element {
  const client = useClient();
  const { t, td, fmt } = useI18n();
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
      setMsg(
        err instanceof ApiError
          ? `${err.code}: ${err.message}`
          : t("common.unexpectedError"),
      );
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("exports.title")}</h2>
        <button type="button" onClick={jobs.reload}>
          {t("common.refresh")}
        </button>
      </div>

      <form className="inline-form" onSubmit={request}>
        <select
          value={type}
          aria-label={t("common.type")}
          onChange={(e) => setType(e.target.value as ExportType)}
        >
          {TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
        {selected?.needsAnimal && (
          <input
            value={animalId}
            onChange={(e) => setAnimalId(e.target.value)}
            placeholder={t("exports.animalPlaceholder")}
            aria-label={t("exports.animalPlaceholder")}
            style={{ minWidth: 240 }}
          />
        )}
        <select
          value={format}
          aria-label={t("exports.format")}
          onChange={(e) => setFormat(e.target.value as "json" | "csv")}
        >
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
        <button type="submit" disabled={selected?.needsAnimal && !animalId}>
          {t("exports.generate")}
        </button>
      </form>
      {msg && <p className="error">{msg}</p>}

      {jobs.loading && <p className="muted">{t("common.loading")}</p>}
      {jobs.error && <p className="error">{jobs.error}</p>}
      {jobs.data && jobs.data.items.length === 0 && (
        <p className="muted">{t("exports.empty")}</p>
      )}
      {jobs.data && jobs.data.items.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>{t("common.type")}</th>
              <th>{t("exports.format")}</th>
              <th>{t("common.status")}</th>
              <th>{t("exports.size")}</th>
              <th>{t("exports.download")}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.data.items.map((j) => (
              <tr key={j.id}>
                <td>{td(j.exportType)}</td>
                <td>{td(j.format)}</td>
                <td>{td(j.status)}</td>
                <td className="mono">
                  {j.byteSize ? `${fmt.number(j.byteSize)} B` : "—"}
                </td>
                <td>{j.status === "completed" ? <code>{j.resolvableUrl}</code> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
