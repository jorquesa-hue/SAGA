import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useAsync } from "../use-async.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";
import { Pagination, usePagination } from "../components/Pagination.js";
import { useI18n } from "../i18n/index.js";

/**
 * Animal registry: register new animals, filter the list (visual ID / RFID /
 * status — client-side over the loaded set), open the 360 view, and export a
 * traceability packet (JK-ANI-006).
 */
export function Animals(): JSX.Element {
  const client = useClient();
  const { t, td } = useI18n();
  const { loading, data, error, reload } = useAsync(() => client.animals.list(), []);
  const [exportState, setExportState] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [showForm, setShowForm] = useState(false);

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const q = query.trim().toLowerCase();
    return items.filter((a) => {
      const matchesStatus =
        status === "all" || (a.lifecycleStatus ?? "active") === status;
      const matchesQuery =
        !q ||
        (a.visualId ?? "").toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [data, query, status]);

  const paged = usePagination(filtered, 20);

  const exportPacket = async (animalId: string): Promise<void> => {
    setExportState((s) => ({ ...s, [animalId]: t("animals.generating") }));
    try {
      const job = await client.exports.request({
        exportType: "animal_traceability_packet",
        format: "json",
        params: { animalId },
      });
      const processed = await client.exports.process(job.id);
      setExportState((s) => ({
        ...s,
        [animalId]:
          processed.status === "completed"
            ? t("animals.ready", { url: processed.resolvableUrl })
            : t("animals.statusMsg", { status: td(processed.status) }),
      }));
    } catch (e) {
      setExportState((s) => ({
        ...s,
        [animalId]: t("animals.failCode", {
          code: e instanceof ApiError ? e.code : t("common.unexpectedError"),
        }),
      }));
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("animals.title")}</h2>
        <button type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("animals.close") : t("animals.register")}
        </button>
      </div>

      {showForm && (
        <RegisterForm
          onDone={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}

      <div className="inline-form">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("animals.searchPlaceholder")}
          aria-label={t("animals.searchPlaceholder")}
          style={{ minWidth: 220 }}
        />
        <select
          value={status}
          aria-label={t("common.status")}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">{t("animals.allStatus")}</option>
          <option value="active">{td("active")}</option>
          <option value="sold">{td("sold")}</option>
          <option value="deceased">{td("deceased")}</option>
          <option value="quarantined">{td("quarantined")}</option>
        </select>
        <span className="muted">
          {t("animals.count", { shown: filtered.length, total: data?.items.length ?? 0 })}
        </span>
      </div>

      {loading && <p className="muted">{t("dashboard.loading")}</p>}
      {error && <p className="error">{error}</p>}
      {data && filtered.length === 0 && <p className="muted">{t("animals.empty")}</p>}
      {filtered.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>{t("animals.colVisual")}</th>
              <th>{t("animals.colSex")}</th>
              <th>{t("animals.colBreed")}</th>
              <th>{t("animals.colStatus")}</th>
              <th>{t("animals.colTrace")}</th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link className="mono" to={`/animals/${a.id}`}>
                    {a.visualId ?? a.id.slice(0, 8)}
                  </Link>
                </td>
                <td>{td(a.sex)}</td>
                <td>{a.breedCode ?? "—"}</td>
                <td>{td(a.lifecycleStatus)}</td>
                <td>
                  <button type="button" onClick={() => void exportPacket(a.id)}>
                    {t("animals.export")}
                  </button>
                  {exportState[a.id] && (
                    <span className="hint"> {exportState[a.id]}</span>
                  )}
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
  const { t } = useI18n();
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
      t("animals.registered"),
    );
  };

  return (
    <div className="form">
      <h3>{t("animals.register")}</h3>
      <Field
        label={t("animals.farmId")}
        value={farmId}
        onChange={setFarmId}
        placeholder={t("animals.farmPlaceholder")}
      />
      <Field
        label={t("animals.visualId")}
        value={visualId}
        onChange={setVisualId}
        placeholder={t("animals.visualPlaceholder")}
      />
      <SelectField
        label={t("animals.sex")}
        value={sex}
        onChange={setSex}
        options={[
          { value: "female", label: t("repro.sexFemale") },
          { value: "male", label: t("repro.sexMale") },
          { value: "unknown", label: t("repro.sexUnknown") },
        ]}
      />
      <Field label={t("animals.breed")} value={breedCode} onChange={setBreedCode} />
      <Field label={t("animals.birthDate")} value={birthDate} onChange={setBirthDate} />
      <Field label={t("animals.rfid")} value={rfid} onChange={setRfid} />
      <div className="card-actions">
        <button
          type="button"
          disabled={cmd.busy || !farmId || !visualId}
          onClick={submit}
        >
          {t("animals.submit")}
        </button>
        <button type="button" onClick={onDone}>
          {t("animals.done")}
        </button>
      </div>
      <FormMessage state={cmd} />
    </div>
  );
}
