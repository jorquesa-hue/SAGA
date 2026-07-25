import { useState } from "react";
import { ApiError } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";

/** Operational alert queue (§26): acknowledge and resolve, evidence-linked. */
export function Alerts(): JSX.Element {
  const client = useClient();
  const { t, td } = useI18n();
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
        <h2>{t("alerts.title")}</h2>
        <button type="button" onClick={reload}>
          {t("common.refresh")}
        </button>
      </div>
      {loading && <p className="muted">{t("common.loading")}</p>}
      {error && <p className="error">{error}</p>}
      {data && data.items.length === 0 && <p className="muted">{t("alerts.empty")}</p>}
      {data && data.items.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>{t("common.type")}</th>
              <th>{t("alerts.severity")}</th>
              <th>{t("common.status")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => {
              const id = String(a.id ?? a.alertId ?? "");
              const status = String(a.status ?? "open");
              return (
                <tr key={id}>
                  <td>{td(a.alertType ?? a.type)}</td>
                  <td>
                    <span className={`badge risk-${String(a.severity ?? "low")}`}>
                      {td(a.severity)}
                    </span>
                  </td>
                  <td>{td(status)}</td>
                  <td>
                    <button
                      type="button"
                      disabled={busy === id || status !== "open"}
                      onClick={() => void act(id, () => client.alerts.acknowledge(id))}
                    >
                      {t("alerts.acknowledge")}
                    </button>{" "}
                    <button
                      type="button"
                      disabled={busy === id || status === "resolved"}
                      onClick={() => void act(id, () => client.alerts.resolve(id))}
                    >
                      {t("alerts.resolve")}
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
