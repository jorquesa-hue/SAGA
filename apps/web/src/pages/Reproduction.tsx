import { useState } from "react";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";
import { RecordList } from "../components/RecordList.js";
import type { ReproductionEventView } from "@jk/contracts-rest";

/**
 * Reproduction events (§21): the service → pregnancy check → calving flow.
 * Each sub-form posts to its command; calving may register and link a calf.
 */
export function Reproduction(): JSX.Element {
  const { t } = useI18n();
  return (
    <section>
      <div className="page-head">
        <h2>{t("repro.title")}</h2>
      </div>
      <ServiceForm />
      <PregnancyForm />
      <CalvingForm />
      <StationLedger />
    </section>
  );
}

/**
 * The station as it happened: services, diagnoses and calvings interleaved in
 * one stream. A technician follows a dam across all three — splitting them
 * into three lists would force the reader to re-merge them by eye.
 */
function StationLedger(): JSX.Element {
  const client = useClient();
  const { t, td, fmt } = useI18n();

  return (
    <RecordList<ReproductionEventView>
      titleKey="repro.ledger"
      load={() => client.overview.reproductionEvents()}
      rowKey={(e) => `${e.kind}:${e.id}`}
      emptyKey="repro.empty"
      columns={[
        {
          headerKey: "common.date",
          figure: true,
          render: (e) => fmt.date(e.occurredAt),
        },
        {
          headerKey: "common.type",
          render: (e) => <span className="badge">{t(`repro.kind.${e.kind}`)}</span>,
        },
        {
          headerKey: "repro.damCol",
          render: (e) => <span className="mono">{e.damVisualId}</span>,
        },
        { headerKey: "repro.method", render: (e) => td(e.detail) },
        {
          headerKey: "repro.outcome",
          render: (e) => (e.result === null ? "—" : td(e.result)),
        },
        {
          headerKey: "repro.expected",
          figure: true,
          render: (e) =>
            e.expectedCalvingDate === null ? "—" : fmt.date(e.expectedCalvingDate),
        },
        {
          headerKey: "repro.calf",
          render: (e) =>
            e.calfVisualId === null ? (
              "—"
            ) : (
              <span className="mono">{e.calfVisualId}</span>
            ),
        },
      ]}
    />
  );
}

function ServiceForm(): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const cmd = useCommand();
  const [damId, setDamId] = useState("");
  const [method, setMethod] = useState("ai");
  const [bullId, setBullId] = useState("");
  const [serviceDate, setServiceDate] = useState(new Date().toISOString());

  return (
    <div className="form">
      <h3>{t("repro.serviceTitle")}</h3>
      <Field label={t("repro.dam")} value={damId} onChange={setDamId} />
      <SelectField
        label={t("repro.method")}
        value={method}
        onChange={setMethod}
        options={[
          { value: "ai", label: t("repro.methodAi") },
          { value: "tai", label: t("repro.methodTai") },
          { value: "natural", label: t("repro.methodNatural") },
        ]}
      />
      <Field label={t("repro.bull")} value={bullId} onChange={setBullId} />
      <Field label={t("repro.date")} value={serviceDate} onChange={setServiceDate} />
      <button
        type="button"
        disabled={cmd.busy || !damId}
        onClick={() =>
          void cmd.run(() =>
            client.reproductionCommands.recordService({
              damId,
              method,
              serviceDate,
              ...(bullId ? { bullId } : {}),
            }),
          )
        }
      >
        {t("repro.recordService")}
      </button>
      <FormMessage state={cmd} />
    </div>
  );
}

function PregnancyForm(): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const cmd = useCommand();
  const [damId, setDamId] = useState("");
  const [result, setResult] = useState("positive");
  const [checkDate, setCheckDate] = useState(new Date().toISOString());

  return (
    <div className="form">
      <h3>{t("repro.pregTitle")}</h3>
      <Field label={t("repro.dam")} value={damId} onChange={setDamId} />
      <SelectField
        label={t("repro.result")}
        value={result}
        onChange={setResult}
        options={[
          { value: "positive", label: t("repro.resultPositive") },
          { value: "negative", label: t("repro.resultNegative") },
          { value: "uncertain", label: t("repro.resultUncertain") },
          { value: "loss", label: t("repro.resultLoss") },
        ]}
      />
      <Field label={t("repro.date")} value={checkDate} onChange={setCheckDate} />
      <button
        type="button"
        disabled={cmd.busy || !damId}
        onClick={() =>
          void cmd.run(() =>
            client.reproductionCommands.recordPregnancyCheck({
              damId,
              result,
              checkDate,
            }),
          )
        }
      >
        {t("repro.recordPreg")}
      </button>
      <FormMessage state={cmd} />
    </div>
  );
}

function CalvingForm(): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
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
    void cmd.run(
      () =>
        client.reproductionCommands.recordCalving({
          damId,
          outcome,
          calvingDate,
          ...calf,
        }),
      t("repro.calvingMsg"),
    );
  };

  return (
    <div className="form">
      <h3>{t("repro.calvingTitle")}</h3>
      <Field label={t("repro.dam")} value={damId} onChange={setDamId} />
      <SelectField
        label={t("repro.outcome")}
        value={outcome}
        onChange={setOutcome}
        options={[
          { value: "live", label: t("repro.outcomeLive") },
          { value: "stillborn", label: t("repro.outcomeStillborn") },
          { value: "aborted", label: t("repro.outcomeAborted") },
        ]}
      />
      <Field label={t("repro.date")} value={calvingDate} onChange={setCalvingDate} />
      {outcome === "live" && (
        <>
          <Field
            label={t("repro.calfVisual")}
            value={calfVisualId}
            onChange={setCalfVisualId}
          />
          <Field
            label={t("repro.calfFarm")}
            value={calfFarmId}
            onChange={setCalfFarmId}
          />
          <SelectField
            label={t("repro.calfSex")}
            value={calfSex}
            onChange={setCalfSex}
            options={[
              { value: "female", label: t("repro.sexFemale") },
              { value: "male", label: t("repro.sexMale") },
              { value: "unknown", label: t("repro.sexUnknown") },
            ]}
          />
        </>
      )}
      <button type="button" disabled={cmd.busy || !damId} onClick={submit}>
        {t("repro.recordCalving")}
      </button>
      <FormMessage state={cmd} />
    </div>
  );
}
