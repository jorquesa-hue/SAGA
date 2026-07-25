import { useState } from "react";
import { ApiError } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { RecordList } from "../components/RecordList.js";
import type { BudgetLineView } from "@jk/contracts-rest";
import { Field, FormMessage, useCommand } from "../components/Form.js";

/**
 * Budgets (§29, JK-FIN-004): set a monthly planned amount per category and
 * compare it against the actual spend (planned − actual = variance). Amounts
 * are recorded and reported in the tenant's base currency; the API guards the
 * write currency and returns the currency on the variance read.
 */
export function Budgets(): JSX.Element {
  const client = useClient();
  const { t, td, fmt, currency } = useI18n();
  const set = useCommand();

  const [period, setPeriod] = useState("");
  const [category, setCategory] = useState("");
  const [planned, setPlanned] = useState("");

  const [qPeriod, setQPeriod] = useState("");
  const [qCategory, setQCategory] = useState("");
  const [variance, setVariance] = useState<Record<string, unknown> | null>(null);
  const [qError, setQError] = useState<string | null>(null);
  const [qBusy, setQBusy] = useState(false);

  const saveBudget = (): void => {
    void set.run(
      () =>
        client.finance.setBudget({ periodMonth: period, category, planned, currency }),
      t("budgets.saved"),
    );
  };

  const loadVariance = async (): Promise<void> => {
    setQBusy(true);
    setQError(null);
    try {
      setVariance(await client.finance.budgetVariance(qPeriod, qCategory));
    } catch (e) {
      setVariance(null);
      setQError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : t("common.unexpectedError"),
      );
    } finally {
      setQBusy(false);
    }
  };

  const money = (v: unknown): string =>
    fmt.currency(v, variance?.currency as string | undefined);

  return (
    <section>
      <div className="page-head">
        <h2>{t("budgets.title")}</h2>
      </div>

      <div className="form">
        <h3>{t("budgets.setTitle")}</h3>
        <Field
          label={t("budgets.period")}
          value={period}
          onChange={setPeriod}
          placeholder="2026-07"
        />
        <Field
          label={t("budgets.category")}
          value={category}
          onChange={setCategory}
          placeholder={t("budgets.categoryPlaceholder")}
        />
        <Field
          label={t("budgets.planned")}
          value={planned}
          onChange={setPlanned}
          // A placeholder teaches the expected format, so it has to be the
          // reader's own: pt-BR writes 1.250,00 where en-US writes 1,250.00
          // (docs/brand §2.4).
          placeholder={fmt.number(1250, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        />
        <button
          type="button"
          disabled={set.busy || !/^\d{4}-\d{2}$/.test(period) || !category || !planned}
          onClick={saveBudget}
        >
          {t("budgets.save")}
        </button>
        <FormMessage state={set} />
      </div>

      <div className="form">
        <h3>{t("budgets.varianceTitle")}</h3>
        <Field
          label={t("budgets.period")}
          value={qPeriod}
          onChange={setQPeriod}
          placeholder="2026-07"
        />
        <Field
          label={t("budgets.category")}
          value={qCategory}
          onChange={setQCategory}
          placeholder={t("budgets.categoryPlaceholder")}
        />
        <button
          type="button"
          disabled={qBusy || !/^\d{4}-\d{2}$/.test(qPeriod) || !qCategory}
          onClick={() => void loadVariance()}
        >
          {t("budgets.load")}
        </button>
        {qError && <p className="error">{qError}</p>}
        {variance && (
          <div className="kpi-grid" style={{ marginTop: "1rem" }}>
            <div className="kpi">
              <span className="kpi-label">{t("budgets.plannedLabel")}</span>
              <span className="kpi-value">{money(variance.planned)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t("budgets.actual")}</span>
              <span className="kpi-value">{money(variance.actual)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t("budgets.variance")}</span>
              <span className="kpi-value">{money(variance.variance)}</span>
            </div>
          </div>
        )}
      </div>

      <RecordList<BudgetLineView>
        titleKey="budgets.lines"
        load={() => client.overview.budgetLines()}
        rowKey={(b) => `${b.periodMonth}:${b.category}`}
        emptyKey="budgets.empty"
        columns={[
          { headerKey: "budgets.periodCol", figure: true, render: (b) => b.periodMonth },
          { headerKey: "finance.category", render: (b) => td(b.category) },
          {
            headerKey: "budgets.plannedLabel",
            figure: true,
            render: (b) => fmt.currency(b.plannedMinor / 100, b.currency),
          },
          {
            headerKey: "budgets.actual",
            figure: true,
            render: (b) => fmt.currency(b.actualMinor / 100, b.currency),
          },
          {
            headerKey: "budgets.variance",
            figure: true,
            // Over plan is the state worth colouring; under plan is not news.
            render: (b) => {
              const delta = b.plannedMinor - b.actualMinor;
              const text = fmt.currency(delta / 100, b.currency);
              return delta < 0 ? <span className="warn">{text}</span> : text;
            },
          },
        ]}
      />
    </section>
  );
}
