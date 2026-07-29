import { RecordList } from "../components/RecordList.js";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import type { EvaluationView } from "@jk/contracts-rest";

/**
 * Genetics (§25). Breeding values are pivoted to one row per animal, because
 * selection is a comparison between animals — reading seven rows per animal
 * makes that comparison impossible.
 *
 * Each cell shows the value with its percentile: a +14 kg breeding value means
 * nothing without knowing where it sits in the population.
 */

/** Traits shown as columns, in the order a Brangus summary prints them. */
const TRAITS = ["PN", "P240", "P365", "PE365", "MP240", "IPP", "ACAB"] as const;

export function Genetics(): JSX.Element {
  const client = useClient();
  const { t, td, fmt } = useI18n();

  const cell = (row: EvaluationView, code: string): JSX.Element | string => {
    const trait = row.traits.find((x) => x.trait === code);
    if (!trait) return "—";
    return (
      <span title={t("genetics.reliability", { r: trait.reliability ?? 0 })}>
        {fmt.number(trait.value, { maximumFractionDigits: 2 })}
        {trait.percentile !== null && (
          <span className="muted">
            {" "}
            ({fmt.number(trait.percentile, { maximumFractionDigits: 0 })}%)
          </span>
        )}
      </span>
    );
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("genetics.title")}</h2>
      </div>
      <RecordList<EvaluationView>
        titleKey="genetics.evaluations"
        load={() => client.overview.evaluations()}
        rowKey={(e) => e.animalId}
        emptyKey="genetics.empty"
        columns={[
          {
            headerKey: "common.animal",
            render: (e) => <span className="mono">{e.visualId}</span>,
          },
          { headerKey: "common.sex", render: (e) => td(e.sex) },
          ...TRAITS.map((code) => ({
            headerKey: `genetics.trait.${code}`,
            figure: true,
            render: (e: EvaluationView) => cell(e, code),
          })),
          {
            headerKey: "genetics.evaluated",
            figure: true,
            render: (e) => fmt.date(e.evaluationDate),
          },
        ]}
      >
        <p className="muted">{t("genetics.note")}</p>
      </RecordList>
    </section>
  );
}
