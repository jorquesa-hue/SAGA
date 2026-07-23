import { useState } from "react";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

/** Finance entries (§29): record expenses, revenue, and animal/lot sales. */
export function Finance(): JSX.Element {
  const client = useClient();
  const { t, fmt } = useI18n();
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
      t("finance.entryMsg", { amount: fmt.currency(amount) }),
    );
  };

  const submitSale = (): void => {
    const target = saleKind === "animal" ? { animalId: saleTarget } : { lotId: saleTarget };
    void sale.run(() => client.finance.recordSale({ ...target, gross }), t("finance.saleMsg", { amount: fmt.currency(gross) }));
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("finance.title")}</h2>
      </div>

      <div className="form">
        <h3>{t("finance.entryTitle")}</h3>
        <SelectField
          label={t("finance.type")}
          value={entryType}
          onChange={setEntryType}
          options={[
            { value: "expense", label: t("finance.typeExpense") },
            { value: "revenue", label: t("finance.typeRevenue") },
          ]}
        />
        <Field label={t("finance.category")} value={category} onChange={setCategory} placeholder={t("finance.categoryPlaceholder")} />
        <Field label={t("finance.amount")} value={amount} onChange={setAmount} />
        <Field label={t("finance.counterparty")} value={counterparty} onChange={setCounterparty} />
        <button type="button" disabled={entry.busy || !category || !amount} onClick={submitEntry}>
          {t("finance.record")}
        </button>
        <FormMessage state={entry} />
      </div>

      <div className="form">
        <h3>{t("finance.saleTitle")}</h3>
        <SelectField
          label={t("finance.target")}
          value={saleKind}
          onChange={setSaleKind}
          options={[
            { value: "animal", label: t("finance.targetAnimal") },
            { value: "lot", label: t("finance.targetLot") },
          ]}
        />
        <Field label={saleKind === "animal" ? t("finance.animalId") : t("finance.lotId")} value={saleTarget} onChange={setSaleTarget} />
        <Field label={t("finance.gross")} value={gross} onChange={setGross} />
        <button type="button" disabled={sale.busy || !saleTarget || !gross} onClick={submitSale}>
          {t("finance.recordSale")}
        </button>
        <FormMessage state={sale} />
      </div>
    </section>
  );
}
