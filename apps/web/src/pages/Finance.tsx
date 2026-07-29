import { useState } from "react";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { RecordList } from "../components/RecordList.js";
import type { LedgerEntryView, SaleView } from "@jk/contracts-rest";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

/** Finance entries (§29): record expenses, revenue, and animal/lot sales. */
export function Finance(): JSX.Element {
  const client = useClient();
  const { t, td, fmt, currency } = useI18n();
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
    // Record the amount in the tenant's active currency so the stored subledger
    // entry is self-describing (JK-DOM-008), not silently defaulted server-side.
    const body = {
      category,
      amount,
      currency,
      ...(counterparty ? { counterparty } : {}),
    };
    void entry.run(
      () =>
        entryType === "expense"
          ? client.finance.recordExpense(body)
          : client.finance.recordRevenue(body),
      t("finance.entryMsg", { amount: fmt.currency(amount) }),
    );
  };

  const submitSale = (): void => {
    const target =
      saleKind === "animal" ? { animalId: saleTarget } : { lotId: saleTarget };
    void sale.run(
      () => client.finance.recordSale({ ...target, gross, currency }),
      t("finance.saleMsg", { amount: fmt.currency(gross) }),
    );
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
        <Field
          label={t("finance.category")}
          value={category}
          onChange={setCategory}
          placeholder={t("finance.categoryPlaceholder")}
        />
        <Field label={t("finance.amount")} value={amount} onChange={setAmount} />
        <Field
          label={t("finance.counterparty")}
          value={counterparty}
          onChange={setCounterparty}
        />
        <button
          type="button"
          disabled={entry.busy || !category || !amount}
          onClick={submitEntry}
        >
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
        <Field
          label={saleKind === "animal" ? t("finance.animalId") : t("finance.lotId")}
          value={saleTarget}
          onChange={setSaleTarget}
        />
        <Field label={t("finance.gross")} value={gross} onChange={setGross} />
        <button
          type="button"
          disabled={sale.busy || !saleTarget || !gross}
          onClick={submitSale}
        >
          {t("finance.recordSale")}
        </button>
        <FormMessage state={sale} />
      </div>

      <RecordList<LedgerEntryView>
        titleKey="finance.ledger"
        load={() => client.overview.ledger()}
        rowKey={(e) => e.id}
        emptyKey="finance.noEntries"
        columns={[
          {
            headerKey: "common.date",
            figure: true,
            render: (e) => fmt.date(e.occurredAt),
          },
          {
            headerKey: "common.type",
            render: (e) => (
              <span className={`badge ${e.entryType === "revenue" ? "ok" : ""}`}>
                {td(e.entryType)}
              </span>
            ),
          },
          { headerKey: "finance.category", render: (e) => td(e.category) },
          { headerKey: "finance.counterpartyCol", render: (e) => e.counterparty ?? "—" },
          { headerKey: "common.farm", render: (e) => e.farmName ?? "—" },
          {
            headerKey: "finance.amountCol",
            figure: true,
            // Amounts are stored in minor units; only the display divides.
            render: (e) => {
              const value = fmt.currency(e.amountMinor / 100, e.currency);
              return e.reversesEntryId ? (
                <span className="warn" title={t("finance.reversalTitle")}>
                  −{value}
                </span>
              ) : (
                value
              );
            },
          },
        ]}
      />

      <RecordList<SaleView>
        titleKey="finance.sales"
        load={() => client.overview.sales()}
        rowKey={(s) => s.id}
        emptyKey="finance.noSales"
        columns={[
          {
            headerKey: "common.date",
            figure: true,
            render: (s) => fmt.date(s.soldAt),
          },
          {
            headerKey: "common.animal",
            render: (s) => <span className="mono">{s.visualId ?? "—"}</span>,
          },
          { headerKey: "finance.lot", render: (s) => s.lotName ?? "—" },
          {
            headerKey: "finance.weight",
            figure: true,
            render: (s) => (s.weightKg === null ? "—" : `${fmt.number(s.weightKg)} kg`),
          },
          { headerKey: "finance.basis", render: (s) => td(s.priceBasis) },
          {
            headerKey: "finance.grossCol",
            figure: true,
            render: (s) => fmt.currency(s.grossMinor / 100, s.currency),
          },
          {
            headerKey: "finance.net",
            figure: true,
            render: (s) => fmt.currency(s.netReceiptMinor / 100, s.currency),
          },
        ]}
      />
    </section>
  );
}
