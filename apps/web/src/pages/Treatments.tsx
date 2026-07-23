import { useState } from "react";
import { useClient } from "../session.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

/**
 * Record a treatment/vaccination (§23). A positive withdrawal period creates a
 * sale-clear restriction server-side (JK-DOM-011) — surfaced to the operator.
 */
export function Treatments(): JSX.Element {
  const client = useClient();
  const cmd = useCommand();
  const [animalId, setAnimalId] = useState("");
  const [kind, setKind] = useState("treatment");
  const [productName, setProductName] = useState("");
  const [dose, setDose] = useState("");
  const [doseUnit, setDoseUnit] = useState("mL");
  const [withdrawalDays, setWithdrawalDays] = useState("0");
  const [administeredAt, setAdministeredAt] = useState(new Date().toISOString());

  const submit = (): void => {
    void cmd.run(
      () =>
        client.healthCommands.recordTreatment(animalId, {
          kind,
          productName,
          administeredAt,
          ...(dose ? { dose: Number(dose), doseUnit } : {}),
          ...(withdrawalDays ? { withdrawalDays: Number(withdrawalDays) } : {}),
        }),
      Number(withdrawalDays) > 0 ? "Tratamento registrado — restrição de carência criada" : "Tratamento registrado",
    );
  };

  return (
    <section>
      <div className="page-head">
        <h2>Registrar tratamento</h2>
      </div>
      <div className="form">
        <Field label="Animal ID (UUID)" value={animalId} onChange={setAnimalId} placeholder="animal uuid" />
        <SelectField
          label="Tipo"
          value={kind}
          onChange={setKind}
          options={[
            { value: "treatment", label: "Tratamento" },
            { value: "vaccination", label: "Vacinação" },
          ]}
        />
        <Field label="Produto" value={productName} onChange={setProductName} placeholder="ex.: Ivermectina" />
        <Field label="Dose" value={dose} onChange={setDose} placeholder="ex.: 10" type="number" />
        <Field label="Unidade da dose" value={doseUnit} onChange={setDoseUnit} />
        <Field label="Carência (dias)" value={withdrawalDays} onChange={setWithdrawalDays} type="number" />
        <Field label="Aplicado em (ISO)" value={administeredAt} onChange={setAdministeredAt} />
        <button type="button" disabled={cmd.busy || !animalId || !productName} onClick={submit}>
          Registrar
        </button>
        <FormMessage state={cmd} />
      </div>
    </section>
  );
}
