import { useState } from "react";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";
import { RecordList } from "../components/RecordList.js";
import type {
  HealthCaseView,
  HealthProtocolView,
  RestrictionView,
  TreatmentView,
} from "@jk/contracts-rest";

/**
 * Record a treatment/vaccination (§23). A positive withdrawal period creates a
 * sale-clear restriction server-side (JK-DOM-011) — surfaced to the operator.
 */
export function Treatments(): JSX.Element {
  const client = useClient();
  const { t, td, fmt } = useI18n();
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
      Number(withdrawalDays) > 0
        ? t("treatments.recordedWithRestriction")
        : t("treatments.recorded"),
    );
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("treatments.title")}</h2>
      </div>
      <div className="form">
        <Field
          label={t("treatments.animalId")}
          value={animalId}
          onChange={setAnimalId}
          placeholder={t("treatments.animalPlaceholder")}
        />
        <SelectField
          label={t("treatments.kind")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "treatment", label: t("treatments.kindTreatment") },
            { value: "vaccination", label: t("treatments.kindVaccination") },
          ]}
        />
        <Field
          label={t("treatments.product")}
          value={productName}
          onChange={setProductName}
          placeholder={t("treatments.productPlaceholder")}
        />
        <Field
          label={t("treatments.dose")}
          value={dose}
          onChange={setDose}
          placeholder={t("treatments.dosePlaceholder")}
          type="number"
        />
        <Field label={t("treatments.doseUnit")} value={doseUnit} onChange={setDoseUnit} />
        <Field
          label={t("treatments.withdrawal")}
          value={withdrawalDays}
          onChange={setWithdrawalDays}
          type="number"
        />
        <Field
          label={t("treatments.administeredAt")}
          value={administeredAt}
          onChange={setAdministeredAt}
        />
        <button
          type="button"
          disabled={cmd.busy || !animalId || !productName}
          onClick={submit}
        >
          {t("treatments.submit")}
        </button>
        <FormMessage state={cmd} />
      </div>

      <RecordList<RestrictionView>
        titleKey="treatments.restrictions"
        load={() => client.overview.restrictions()}
        rowKey={(r) => r.id}
        emptyKey="treatments.noRestrictions"
        columns={[
          {
            headerKey: "common.animal",
            render: (r) => <span className="mono">{r.visualId}</span>,
          },
          { headerKey: "common.type", render: (r) => td(r.restrictionType) },
          { headerKey: "treatments.reason", render: (r) => r.reason ?? "—" },
          {
            headerKey: "treatments.clearedAfter",
            figure: true,
            // While this date is in the future the animal cannot be cleared
            // for sale — that is the whole point of the row.
            render: (r) => (r.validTo === null ? "—" : fmt.date(r.validTo)),
          },
        ]}
      >
        <p className="muted">{t("treatments.restrictionsNote")}</p>
      </RecordList>

      <RecordList<TreatmentView>
        titleKey="treatments.recent"
        load={() => client.overview.treatments()}
        rowKey={(x) => x.id}
        emptyKey="treatments.noTreatments"
        columns={[
          {
            headerKey: "common.animal",
            render: (x) => <span className="mono">{x.visualId}</span>,
          },
          { headerKey: "common.type", render: (x) => td(x.kind) },
          { headerKey: "treatments.product", render: (x) => x.productName },
          {
            headerKey: "treatments.batch",
            render: (x) => <span className="mono">{x.medicineBatch ?? "—"}</span>,
          },
          {
            headerKey: "treatments.dose",
            figure: true,
            render: (x) =>
              x.dose === null ? "—" : `${fmt.number(x.dose)} ${x.doseUnit ?? ""}`,
          },
          { headerKey: "treatments.protocol", render: (x) => x.protocolName ?? "—" },
          {
            headerKey: "common.date",
            figure: true,
            render: (x) => fmt.date(x.administeredAt),
          },
        ]}
      />

      <RecordList<HealthCaseView>
        titleKey="treatments.cases"
        load={() => client.overview.healthCases()}
        rowKey={(c) => c.id}
        emptyKey="treatments.noCases"
        columns={[
          {
            headerKey: "common.animal",
            render: (c) => <span className="mono">{c.visualId}</span>,
          },
          { headerKey: "treatments.symptom", render: (c) => c.symptom ?? "—" },
          { headerKey: "treatments.diagnosis", render: (c) => c.diagnosis ?? "—" },
          {
            headerKey: "common.status",
            render: (c) => <span className="badge">{td(c.status)}</span>,
          },
          {
            headerKey: "treatments.opened",
            figure: true,
            render: (c) => fmt.date(c.openedAt),
          },
        ]}
      />

      <RecordList<HealthProtocolView>
        titleKey="treatments.protocols"
        load={() => client.overview.healthProtocols()}
        rowKey={(p) => p.id}
        emptyKey="treatments.noProtocols"
        columns={[
          { headerKey: "common.name", render: (p) => p.name },
          { headerKey: "treatments.appliesTo", render: (p) => p.appliesTo ?? "—" },
          { headerKey: "common.status", render: (p) => td(p.status) },
          {
            headerKey: "treatments.applications",
            figure: true,
            render: (p) => fmt.number(p.treatmentCount),
          },
        ]}
      />
    </section>
  );
}
