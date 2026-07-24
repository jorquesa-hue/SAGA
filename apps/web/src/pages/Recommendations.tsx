import { useState } from "react";
import { ApiError, type Recommendation } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";

/**
 * Governed-AI review queue (§61–§64). Every recommendation shows its risk and
 * whether it is prohibited from autonomous execution; approval is a deliberate
 * human action and is disabled for prohibited proposals — the block is enforced
 * server-side regardless.
 */
export function Recommendations(): JSX.Element {
  const client = useClient();
  const { t, td } = useI18n();
  const { loading, data, error, reload } = useAsync(() => client.recommendations.list("pending"), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const approve = async (rec: Recommendation): Promise<void> => {
    setBusy(rec.id);
    try {
      await client.recommendations.approve(rec.id);
      setNote((n) => ({ ...n, [rec.id]: t("rec.approved") }));
      reload();
    } catch (e) {
      setNote((n) => ({ ...n, [rec.id]: e instanceof ApiError ? e.code : "erro" }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("rec.title")}</h2>
        <button type="button" onClick={reload}>
          {t("common.refresh")}
        </button>
      </div>
      {loading && <p className="muted">{t("common.loading")}</p>}
      {error && <p className="error">{error}</p>}
      {data && data.items.length === 0 && <p className="muted">{t("rec.empty")}</p>}
      <ul className="cards">
        {data?.items.map((rec) => (
          <li className="card" key={rec.id}>
            <div className="card-head">
              <strong>{rec.proposedActionCategory}</strong>
              <span className={`badge risk-${rec.riskClass ?? "low"}`}>{td(rec.riskClass ?? "low")}</span>
              {rec.prohibited && <span className="badge prohibited">{t("rec.prohibited")}</span>}
              {rec.highImpact && !rec.prohibited && <span className="badge high">{t("rec.highImpact")}</span>}
            </div>
            <p className="muted">
              {t("rec.confidence", { pct: Math.round(rec.confidence * 100), n: rec.evidenceEventIds.length })}
            </p>
            <div className="card-actions">
              <button type="button" disabled={rec.prohibited || busy === rec.id} onClick={() => void approve(rec)}>
                {t("rec.approve")}
              </button>
              {note[rec.id] && <span className="hint">{note[rec.id]}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
