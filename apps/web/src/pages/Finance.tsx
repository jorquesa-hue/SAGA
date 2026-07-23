import { useState } from "react";
import { useClient } from "../session.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

/** Finance entries (§29): record expenses, revenue, and animal/lot sales. */
export function Finance(): JSX.Element {
  const client = useClient();
  const entry = useCommand();
  const sale = useCommand();

  const [entryType, setEntryType] = useState("expense");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");

  const [saleTarget, setSaleTarget] = useState("");
  const [gross, setGross] = useState("");
  const [saleKind, setSaleKind] = useState("animal");

  const submitEntry = (): void => {
    const body = { category, amount, ...(counterparty ? { counterparty } : {}) };
    void entry.run(
      () => (entryType === "expense" ? client.finance.recordExpense(body) : client.finance.recordRevenue(body)),
      "Lançamento registrado",
    );
  };

  const submitSale = (): void => {
    const target = saleKind === "animal" ? { animalId: saleTarget } : { lotId: saleTarget };
    void sale.run(() => client.finance.recordSale({ ...target, gross }), "Venda registrada");
  };

  return (
    <section>
      <div className="page-head">
        <h2>Financeiro</h2>
      </div>

      <div className="form">
        <h3>Lançamento (despesa / receita)</h3>
        <SelectField
          label="Tipo"
          value={entryType}
          onChange={setEntryType}
          options={[
            { value: "expense", label: "Despesa" },
            { value: "revenue", label: "Receita" },
          ]}
        />
        <Field label="Categoria" value={category} onChange={setCategory} placeholder="ex.: nutrição" />
        <Field label="Valor (ex.: 1250.00)" value={amount} onChange={setAmount} />
        <Field label="Contraparte (opcional)" value={counterparty} onChange={setCounterparty} />
        <button type="button" disabled={entry.busy || !category || !amount} onClick={submitEntry}>
          Registrar
        </button>
        <FormMessage state={entry} />
      </div>

      <div className="form">
        <h3>Venda</h3>
        <SelectField
          label="Alvo"
          value={saleKind}
          onChange={setSaleKind}
          options={[
            { value: "animal", label: "Animal" },
            { value: "lot", label: "Lote" },
          ]}
        />
        <Field label={saleKind === "animal" ? "Animal ID" : "Lote ID"} value={saleTarget} onChange={setSaleTarget} />
        <Field label="Valor bruto (ex.: 8200.00)" value={gross} onChange={setGross} />
        <button type="button" disabled={sale.busy || !saleTarget || !gross} onClick={submitSale}>
          Registrar venda
        </button>
        <FormMessage state={sale} />
      </div>
    </section>
  );
}
