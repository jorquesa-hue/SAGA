import { useState } from "react";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

/**
 * Record a treatment/vaccination (§23). A positive withdrawal period creates a
 * sale-clear restriction server-side (JK-DOM-011) — surfaced to the operator.
 */
export function Treatments(): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
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
    </section>
  );
}
