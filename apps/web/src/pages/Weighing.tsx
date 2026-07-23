import { useState } from "react";
import { useClient } from "../session.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

/**
 * Weighing via a handling session (§18): start a session, capture weight
 * observations (linked by RFID), and close it. Observations carry a unique id
 * so retries are idempotent; unresolved captures land in the session's
 * exception queue server-side.
 */
export function Weighing(): JSX.Element {
  const client = useClient();
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
    typeof globalThis.crypto?.randomUUID === "function" ? crypto.randomUUID() : `obs-${Date.now()}`;

  const startSession = (): void => {
    void start.run(async () => {
      const s = await client.herd.startSession({ farmId, purpose });
      setSessionId(String(s.id ?? s.sessionId ?? ""));
    }, "Sessão iniciada");
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
    }, "Pesagem capturada");
  };

  const closeSession = (): void => {
    if (!sessionId) return;
    void close.run(async () => {
      await client.herd.closeSession(sessionId);
      setSessionId(null);
      setCaptured(0);
    }, "Sessão encerrada");
  };

  return (
    <section>
      <div className="page-head">
        <h2>Pesagem</h2>
      </div>

      {!sessionId && (
        <div className="form">
          <h3>Iniciar sessão de manejo</h3>
          <Field label="Fazenda ID" value={farmId} onChange={setFarmId} />
          <SelectField
            label="Finalidade"
            value={purpose}
            onChange={setPurpose}
            options={[
              { value: "weighing", label: "Pesagem" },
              { value: "vaccination", label: "Vacinação" },
              { value: "handling", label: "Manejo" },
            ]}
          />
          <button type="button" disabled={start.busy || !farmId} onClick={startSession}>
            Iniciar
          </button>
          <FormMessage state={start} />
        </div>
      )}

      {sessionId && (
        <div className="form">
          <h3>
            Capturar pesagem <span className="muted">· sessão {sessionId.slice(0, 8)}… · {captured} capturada(s)</span>
          </h3>
          <Field label="RFID (para vincular o animal)" value={rfid} onChange={setRfid} placeholder="982000..." />
          <Field label="Peso (kg)" value={weight} onChange={setWeight} type="number" />
          <button type="button" disabled={obs.busy || !weight} onClick={record}>
            Capturar
          </button>
          <FormMessage state={obs} />
          <button type="button" disabled={close.busy} onClick={closeSession}>
            Encerrar sessão
          </button>
          <FormMessage state={close} />
        </div>
      )}
    </section>
  );
}
