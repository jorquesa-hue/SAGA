import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, type AnimalPhoto } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";
import { metricLabel } from "../i18n/labels.js";
import { Icon } from "../components/Icon.js";
import { useCommand, FormMessage } from "../components/Form.js";

/**
 * Animal 360 view — identity plus the cross-context history (weights,
 * restrictions, treatments, reproduction) and a one-click traceability export
 * (JK-ANI-006). Each section loads independently and degrades gracefully.
 */
export function AnimalDetail(): JSX.Element {
  const { id = "" } = useParams();
  const client = useClient();
  const { t, td, fmt } = useI18n();
  const animal = useAsync(() => client.animals.get(id), [id]);
  const weights = useAsync(() => client.animals.weights(id), [id]);
  const restrictions = useAsync(() => client.health.restrictions(id), [id]);
  const treatments = useAsync(() => client.health.treatments(id), [id]);
  const repro = useAsync(() => client.reproduction.status(id), [id]);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const exportPacket = async (): Promise<void> => {
    setExportMsg(t("animalDetail.generating"));
    try {
      const job = await client.exports.request({
        exportType: "animal_traceability_packet",
        format: "json",
        params: { animalId: id },
      });
      const done = await client.exports.process(job.id);
      setExportMsg(
        done.status === "completed"
          ? t("animalDetail.ready", { url: done.resolvableUrl })
          : t("animalDetail.status", { status: done.status }),
      );
    } catch (e) {
      setExportMsg(
        e instanceof ApiError
          ? t("animalDetail.failCode", { code: e.code })
          : t("animalDetail.fail"),
      );
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>
          <Link to="/animals" className="back">
            {t("animalDetail.back")}
          </Link>{" "}
          {/* An identifier is a figure, not display type (docs/brand §3.3). */}
          <span className="mono">{animal.data?.visualId ?? id.slice(0, 8)}</span>
        </h2>
        <div className="card-actions">
          <Link className="button-link" to={`/animals/${id}/record`}>
            {t("animalDetail.viewRecord")}
          </Link>
          <button type="button" onClick={() => void exportPacket()}>
            <Icon name="export" size={16} />
            {t("animalDetail.exportTrace")}
          </button>
        </div>
      </div>
      {exportMsg && <p className="hint">{exportMsg}</p>}

      {animal.error && <p className="error">{animal.error}</p>}
      {animal.data && (
        <div className="kpi-grid">
          <Tile label={t("animalDetail.sex")} value={td(animal.data.sex)} />
          <Tile label={t("animalDetail.breed")} value={animal.data.breedCode} />
          <Tile
            label={t("animalDetail.statusLabel")}
            value={td(animal.data.lifecycleStatus)}
          />
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
                  <td className="mono">{fmt.date(w.occurredAt ?? w.occurred_at)}</td>
                  <td className="mono">{fmt.number(w.weightKg ?? w.weight_kg)}</td>
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
                <strong>{td(r.restrictionType ?? r.restriction_type)}</strong>
                <p className="muted">{td(r.status)}</p>
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
                <strong>
                  {String(
                    tr.productName ??
                      tr.product_name ??
                      tr.treatmentType ??
                      t("animalDetail.treatmentFallback"),
                  )}
                </strong>
                <p className="muted mono">
                  {fmt.date(tr.administeredAt ?? tr.administered_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <PhotoGallery animalId={id} />

      <div className="page-head" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ margin: 0 }}>{t("animalDetail.reproduction")}</h3>
      </div>
      {repro.loading && <p className="muted">{t("common.loading")}</p>}
      {repro.error && <p className="muted">{t("animalDetail.noRepro")}</p>}
      {repro.data && (
        <div className="kpi-grid">
          {Object.entries(repro.data).map(([k, v]) => {
            // Prefer an enum label; otherwise format dates/numbers.
            const enumLabel = td(v);
            const value = enumLabel !== String(v ?? "—") ? enumLabel : fmt.auto(v);
            // Same rule as the dashboard: a reader, not a key path.
            return (
              <Tile
                key={k}
                label={metricLabel("animalDetail.repro", k, t, td)}
                value={value}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Dated photo gallery (JK-ANI photo gallery): a chronological album, not a
 * single replaceable profile picture, so the record shows the animal across
 * its different ages. Each entry loads its bytes lazily via PhotoThumb.
 */
function PhotoGallery({ animalId }: { animalId: string }): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const gallery = useAsync(() => client.animals.photos.list(animalId), [animalId]);
  const upload = useCommand();
  const [takenAt, setTakenAt] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const submit = (): void => {
    if (!file || !takenAt) return;
    void upload.run(async () => {
      await client.animals.photos.upload(animalId, {
        file,
        filename: file.name,
        takenAt,
        caption: caption || undefined,
      });
      setFile(null);
      setCaption("");
      gallery.reload();
    }, t("photos.uploaded"));
  };

  const remove = async (photoId: string): Promise<void> => {
    await client.animals.photos.remove(animalId, photoId);
    gallery.reload();
  };

  return (
    <>
      <div className="page-head" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ margin: 0 }}>{t("photos.title")}</h3>
      </div>

      <div className="form">
        <label className="field">
          <span>{t("photos.file")}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="field">
          <span>{t("photos.takenAt")}</span>
          <input type="date" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("photos.caption")}</span>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} />
        </label>
        <button type="button" disabled={upload.busy || !file || !takenAt} onClick={submit}>
          {upload.busy ? t("photos.uploading") : t("photos.submit")}
        </button>
        <FormMessage state={upload} />
      </div>

      {gallery.loading && <p className="muted">{t("common.loading")}</p>}
      {gallery.error && <p className="muted">{t("animalDetail.noRecords")}</p>}
      {gallery.data && gallery.data.items.length === 0 && (
        <p className="muted">{t("photos.empty")}</p>
      )}
      {gallery.data && gallery.data.items.length > 0 && (
        <ul className="cards photo-gallery">
          {gallery.data.items.map((photo) => (
            <PhotoThumb
              key={photo.id}
              animalId={animalId}
              photo={photo}
              onRemove={() => void remove(photo.id)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function PhotoThumb({
  animalId,
  photo,
  onRemove,
}: {
  animalId: string;
  photo: AnimalPhoto;
  onRemove: () => void;
}): JSX.Element {
  const client = useClient();
  const { t, fmt } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    client.animals.photos
      .download(animalId, photo.id)
      .then(({ blob }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, animalId, photo.id]);

  return (
    <li className="card photo-card">
      {failed && <p className="muted">{t("photos.loadFailed")}</p>}
      {!failed && (url ? <img src={url} alt={photo.caption ?? photo.takenAt} /> : <div className="photo-placeholder" />)}
      <p className="mono muted">{fmt.date(photo.takenAt)}</p>
      {photo.caption && <p>{photo.caption}</p>}
      <button type="button" onClick={onRemove}>
        {t("photos.remove")}
      </button>
    </li>
  );
}

function Tile({ label, value }: { label: string; value: unknown }): JSX.Element {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        {value === null || value === undefined ? "—" : String(value)}
      </span>
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
      {state.data && state.data.items.length === 0 && (
        <p className="muted">{t("animalDetail.noRecords")}</p>
      )}
      {state.data && state.data.items.length > 0 && children(state.data.items)}
    </>
  );
}
