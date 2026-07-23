import { useState } from "react";
import { useClient } from "../session.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

/**
 * Reproduction events (§21): the service → pregnancy check → calving flow.
 * Each sub-form posts to its command; calving may register and link a calf.
 */
export function Reproduction(): JSX.Element {
  return (
    <section>
      <div className="page-head">
        <h2>Reprodução</h2>
      </div>
      <ServiceForm />
      <PregnancyForm />
      <CalvingForm />
    </section>
  );
}

function ServiceForm(): JSX.Element {
  const client = useClient();
  const cmd = useCommand();
  const [damId, setDamId] = useState("");
  const [method, setMethod] = useState("ai");
  const [bullId, setBullId] = useState("");
  const [serviceDate, setServiceDate] = useState(new Date().toISOString());

  return (
    <div className="form">
      <h3>Serviço / cobertura</h3>
      <Field label="Matriz (dam) ID" value={damId} onChange={setDamId} />
      <SelectField
        label="Método"
        value={method}
        onChange={setMethod}
        options={[
          { value: "ai", label: "IA" },
          { value: "tai", label: "IATF" },
          { value: "natural", label: "Monta natural" },
        ]}
      />
      <Field label="Touro (bull) ID (opcional)" value={bullId} onChange={setBullId} />
      <Field label="Data (ISO)" value={serviceDate} onChange={setServiceDate} />
      <button
        type="button"
        disabled={cmd.busy || !damId}
        onClick={() => void cmd.run(() => client.reproductionCommands.recordService({ damId, method, serviceDate, ...(bullId ? { bullId } : {}) }))}
      >
        Registrar serviço
      </button>
      <FormMessage state={cmd} />
    </div>
  );
}

function PregnancyForm(): JSX.Element {
  const client = useClient();
  const cmd = useCommand();
  const [damId, setDamId] = useState("");
  const [result, setResult] = useState("positive");
  const [checkDate, setCheckDate] = useState(new Date().toISOString());

  return (
    <div className="form">
      <h3>Diagnóstico de gestação</h3>
      <Field label="Matriz (dam) ID" value={damId} onChange={setDamId} />
      <SelectField
        label="Resultado"
        value={result}
        onChange={setResult}
        options={[
          { value: "positive", label: "Positivo" },
          { value: "negative", label: "Negativo" },
          { value: "uncertain", label: "Inconclusivo" },
          { value: "loss", label: "Perda" },
        ]}
      />
      <Field label="Data (ISO)" value={checkDate} onChange={setCheckDate} />
      <button
        type="button"
        disabled={cmd.busy || !damId}
        onClick={() => void cmd.run(() => client.reproductionCommands.recordPregnancyCheck({ damId, result, checkDate }))}
      >
        Registrar diagnóstico
      </button>
      <FormMessage state={cmd} />
    </div>
  );
}

function CalvingForm(): JSX.Element {
  const client = useClient();
  const cmd = useCommand();
  const [damId, setDamId] = useState("");
  const [outcome, setOutcome] = useState("live");
  const [calvingDate, setCalvingDate] = useState(new Date().toISOString());
  const [calfVisualId, setCalfVisualId] = useState("");
  const [calfFarmId, setCalfFarmId] = useState("");
  const [calfSex, setCalfSex] = useState("female");

  const submit = (): void => {
    const calf =
      outcome === "live" && calfVisualId && calfFarmId
        ? { calf: { farmId: calfFarmId, visualId: calfVisualId, sex: calfSex } }
        : {};
    void cmd.run(() => client.reproductionCommands.recordCalving({ damId, outcome, calvingDate, ...calf }), "Parto registrado");
  };

  return (
    <div className="form">
      <h3>Parto</h3>
      <Field label="Matriz (dam) ID" value={damId} onChange={setDamId} />
      <SelectField
        label="Desfecho"
        value={outcome}
        onChange={setOutcome}
        options={[
          { value: "live", label: "Nascido vivo" },
          { value: "stillborn", label: "Natimorto" },
          { value: "aborted", label: "Aborto" },
        ]}
      />
      <Field label="Data (ISO)" value={calvingDate} onChange={setCalvingDate} />
      {outcome === "live" && (
        <>
          <Field label="Bezerro — ID visual" value={calfVisualId} onChange={setCalfVisualId} />
          <Field label="Bezerro — fazenda ID" value={calfFarmId} onChange={setCalfFarmId} />
          <SelectField
            label="Bezerro — sexo"
            value={calfSex}
            onChange={setCalfSex}
            options={[
              { value: "female", label: "Fêmea" },
              { value: "male", label: "Macho" },
              { value: "unknown", label: "Desconhecido" },
            ]}
          />
        </>
      )}
      <button type="button" disabled={cmd.busy || !damId} onClick={submit}>
        Registrar parto
      </button>
      <FormMessage state={cmd} />
    </div>
  );
}
