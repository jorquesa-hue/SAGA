import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";

/**
 * Animal 360 view — identity plus the cross-context history (weights,
 * restrictions, treatments, reproduction) and a one-click traceability export
 * (JK-ANI-006). Each section loads independently and degrades gracefully.
 */
export function AnimalDetail(): JSX.Element {
  const { id = "" } = useParams();
  const client = useClient();
  const { t } = useI18n();
  const animal = useAsync(() => client.animals.get(id), [id]);
  const weights = useAsync(() => client.animals.weights(id), [id]);
  const restrictions = useAsync(() => client.health.restrictions(id), [id]);
  const treatments = useAsync(() => client.health.treatments(id), [id]);
  const repro = useAsync(() => client.reproduction.status(id), [id]);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const exportPacket = async (): Promise<void> => {
    setExportMsg(t("animalDetail.generating"));
    try {
      const job = await client.exports.request({ exportType: "animal_traceability_packet", format: "json", params: { animalId: id } });
      const done = await client.exports.process(job.id);
      setExportMsg(done.status === "completed" ? t("animalDetail.ready", { url: done.resolvableUrl }) : t("animalDetail.status", { status: done.status }));
    } catch (e) {
      setExportMsg(e instanceof ApiError ? t("animalDetail.failCode", { code: e.code }) : t("animalDetail.fail"));
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>
          <Link to="/animals" className="back">
            {t("animalDetail.back")}
          </Link>{" "}
          {animal.data?.visualId ?? id.slice(0, 8)}
        </h2>
        <button type="button" onClick={() => void exportPacket()}>
          {t("animalDetail.exportTrace")}
        </button>
      </div>
      {exportMsg && <p className="hint">{exportMsg}</p>}

      {animal.error && <p className="error">{animal.error}</p>}
      {animal.data && (
        <div className="kpi-grid">
          <Tile label={t("animalDetail.sex")} value={animal.data.sex} />
          <Tile label={t("animalDetail.breed")} value={animal.data.breedCode} />
          <Tile label={t("animalDetail.statusLabel")} value={animal.data.lifecycleStatus} />
        </div>
      )}

      <Section title={t("animalDetail.weights")} state={weights}>
        {(rows) => (
          <table className="grid">
            <thead>
              <tr>
                <th>{t("animalDetail.colDate")}</th>
                <th>{t("animalDetail.colWeight")}</th>
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

      <Section title={t("animalDetail.restrictions")} state={restrictions}>
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

      <Section title={t("animalDetail.treatments")} state={treatments}>
        {(rows) => (
          <ul className="cards">
            {rows.map((tr, i) => (
              <li className="card" key={i}>
                <strong>{String(tr.productName ?? tr.product_name ?? tr.treatmentType ?? t("animalDetail.treatmentFallback"))}</strong>
                <p className="muted">{String(tr.administeredAt ?? tr.administered_at ?? "—")}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="page-head" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ margin: 0 }}>{t("animalDetail.reproduction")}</h3>
      </div>
      {repro.loading && <p className="muted">{t("common.loading")}</p>}
      {repro.error && <p className="muted">{t("animalDetail.noRepro")}</p>}
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
  const { t } = useI18n();
  return (
    <>
      <div className="page-head" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      {state.loading && <p className="muted">{t("common.loading")}</p>}
      {state.error && <p className="muted">{t("animalDetail.noRecords")}</p>}
      {state.data && state.data.items.length === 0 && <p className="muted">{t("animalDetail.noRecords")}</p>}
      {state.data && state.data.items.length > 0 && children(state.data.items)}
    </>
  );
}
