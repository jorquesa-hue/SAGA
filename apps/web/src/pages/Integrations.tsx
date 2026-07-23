import { useState, type FormEvent } from "react";
import { ApiError } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";

const FAMILIES = ["animal", "weight", "health", "reproduction", "herd", "inventory", "finance", "genetics", "pasture", "asset"];

/**
 * Webhooks & connectors administration (§33, §51). Create allowlisted-family
 * subscriptions (secret shown once), rotate/deactivate, inspect deliveries and
 * replay dead-letters, and register connectors.
 */
export function Integrations(): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const subs = useAsync(() => client.webhooks.list(), []);
  const deliveries = useAsync(() => client.webhooks.deliveries(), []);
  const connectors = useAsync(() => client.connectors.list(), []);

  const [url, setUrl] = useState("https://");
  const [families, setFamilies] = useState<string[]>(["animal"]);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (f: string): void =>
    setFamilies((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  const subscribe = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setMsg(null);
    try {
      const created = await client.webhooks.subscribe({ url, eventFamilies: families });
      setFreshSecret(created.secret);
      subs.reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? `${err.code}: ${err.message}` : "erro");
    }
  };

  const rotate = async (id: string): Promise<void> => {
    try {
      const r = await client.webhooks.rotateSecret(id);
      setFreshSecret(r.secret);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.code : "erro");
    }
  };

  const replay = async (id: string): Promise<void> => {
    try {
      await client.webhooks.replay(id);
      deliveries.reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.code : "erro");
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("integrations.title")}</h2>
      </div>

      <h3>{t("integrations.newSubTitle")}</h3>
      <form className="inline-form" onSubmit={subscribe}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("integrations.urlPlaceholder")} style={{ minWidth: 260 }} />
        <div className="chips">
          {FAMILIES.map((f) => (
            <label key={f} className={`chip ${families.includes(f) ? "on" : ""}`}>
              <input type="checkbox" checked={families.includes(f)} onChange={() => toggle(f)} />
              {f}
            </label>
          ))}
        </div>
        <button type="submit" disabled={!url.startsWith("https://") || families.length === 0}>
          {t("integrations.subscribe")}
        </button>
      </form>
      {freshSecret && (
        <p className="secret">
          {t("integrations.secretShown")} <code>{freshSecret}</code>
        </p>
      )}
      {msg && <p className="error">{msg}</p>}

      <h3>{t("integrations.subsTitle")}</h3>
      {subs.loading && <p className="muted">{t("common.loading")}</p>}
      {subs.error && <p className="error">{subs.error}</p>}
      {subs.data && (
        <table className="grid">
          <thead>
            <tr>
              <th>{t("integrations.colUrl")}</th>
              <th>{t("integrations.colFamilies")}</th>
              <th>{t("integrations.colActive")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {subs.data.items.map((s) => (
              <tr key={s.id}>
                <td>{s.url}</td>
                <td>{s.eventFamilies.join(", ")}</td>
                <td>{s.active ? t("integrations.yes") : t("integrations.no")}</td>
                <td>
                  <button type="button" onClick={() => void rotate(s.id)}>
                    {t("integrations.rotate")}
                  </button>{" "}
                  <button
                    type="button"
                    disabled={!s.active}
                    onClick={() => void client.webhooks.deactivate(s.id).then(() => subs.reload())}
                  >
                    {t("integrations.deactivate")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>{t("integrations.deliveriesTitle")}</h3>
      {deliveries.data && deliveries.data.items.length === 0 && <p className="muted">{t("integrations.noDeliveries")}</p>}
      {deliveries.data && deliveries.data.items.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>{t("integrations.colEvent")}</th>
              <th>{t("common.status")}</th>
              <th>{t("integrations.colAttempts")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.data.items.map((d) => (
              <tr key={d.id}>
                <td>{d.eventType}</td>
                <td>
                  <span className={d.status === "dead_letter" ? "error" : ""}>{d.status}</span>
                </td>
                <td>
                  {d.attempts}/{d.maxAttempts}
                </td>
                <td>
                  <button
                    type="button"
                    disabled={d.status !== "dead_letter" && d.status !== "failed"}
                    onClick={() => void replay(d.id)}
                  >
                    {t("integrations.replay")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>{t("integrations.connectorsTitle")}</h3>
      {connectors.data && (
        <ul className="cards">
          {connectors.data.items.map((c) => (
            <li className="card" key={c.id}>
              <strong>{c.name}</strong>
              <p className="muted">
                {c.connectorType} · {c.status}
              </p>
            </li>
          ))}
          {connectors.data.items.length === 0 && <p className="muted">{t("integrations.noConnectors")}</p>}
        </ul>
      )}
    </section>
  );
}
