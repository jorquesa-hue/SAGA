import { useState } from "react";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

/**
 * Weighing via a handling session (§18): start a session, capture weight
 * observations (linked by RFID), and close it. Observations carry a unique id
 * so retries are idempotent; unresolved captures land in the session's
 * exception queue server-side.
 */
export function Weighing(): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const start = useCommand();
  const obs = useCommand();
  const close = useCommand();

  const [farmId, setFarmId] = useState("");
  const [purpose, setPurpose] = useState("weighing");
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [rfid, setRfid] = useState("");
  const [weight, setWeight] = useState("");
  const [captured, setCaptured] = useState(0);

  const newId = (): string =>
    typeof globalThis.crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `obs-${Date.now()}`;

  const startSession = (): void => {
    void start.run(async () => {
      const s = await client.herd.startSession({ farmId, purpose });
      setSessionId(String(s.id ?? s.sessionId ?? ""));
    }, t("weighing.startedMsg"));
  };

  const record = (): void => {
    if (!sessionId) return;
    void obs.run(async () => {
      await client.herd.recordObservation(sessionId, {
        observationId: newId(),
        capturedAt: new Date().toISOString(),
        value: Number(weight),
        unit: "kg",
        ...(rfid ? { rfid } : {}),
      });
      setCaptured((c) => c + 1);
      setWeight("");
    }, t("weighing.capturedMsg"));
  };

  const closeSession = (): void => {
    if (!sessionId) return;
    void close.run(async () => {
      await client.herd.closeSession(sessionId);
      setSessionId(null);
      setCaptured(0);
    }, t("weighing.closedMsg"));
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("weighing.title")}</h2>
      </div>

      {!sessionId && (
        <div className="form">
          <h3>{t("weighing.startSession")}</h3>
          <Field label={t("weighing.farmId")} value={farmId} onChange={setFarmId} />
          <SelectField
            label={t("weighing.purpose")}
            value={purpose}
            onChange={setPurpose}
            options={[
              { value: "weighing", label: t("weighing.purposeWeighing") },
              { value: "vaccination", label: t("weighing.purposeVaccination") },
              { value: "handling", label: t("weighing.purposeHandling") },
            ]}
          />
          <button type="button" disabled={start.busy || !farmId} onClick={startSession}>
            {t("weighing.start")}
          </button>
          <FormMessage state={start} />
        </div>
      )}

      {sessionId && (
        <div className="form">
          <h3>
            {t("weighing.captureTitle")}{" "}
            <span className="muted">
              {t("weighing.sessionMeta", { id: sessionId.slice(0, 8), n: captured })}
            </span>
          </h3>
          <Field
            label={t("weighing.rfid")}
            value={rfid}
            onChange={setRfid}
            placeholder="982000..."
          />
          <Field
            label={t("weighing.weight")}
            value={weight}
            onChange={setWeight}
            type="number"
          />
          <button type="button" disabled={obs.busy || !weight} onClick={record}>
            {t("weighing.capture")}
          </button>
          <FormMessage state={obs} />
          <button type="button" disabled={close.busy} onClick={closeSession}>
            {t("weighing.close")}
          </button>
          <FormMessage state={close} />
        </div>
      )}
    </section>
  );
}
