import { useState } from "react";
import type { AnimalImportMapping, ImportJob, ImportPreview } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

type Step = "upload" | "map" | "preview" | "done";

const STEP_KEYS: Record<Step, string> = {
  upload: "imports.stepUpload",
  map: "imports.stepMap",
  preview: "imports.stepPreview",
  done: "imports.stepDone",
};

/**
 * Staged import wizard (§27): upload → map → validate → preview → execute →
 * reconcile. The server owns each stage; this drives it and shows the counts
 * and evidence at every step so nothing is imported blindly.
 */
export function Imports(): JSX.Element {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("upload");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const reset = (): void => {
    setStep("upload");
    setJob(null);
    setHeaders([]);
    setPreview(null);
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("imports.title")}</h2>
        {job && (
          <button type="button" onClick={reset}>
            {t("imports.new")}
          </button>
        )}
      </div>

      <ol className="stepper">
        {(["upload", "map", "preview", "done"] as Step[]).map((s, i) => (
          <li key={s} className={step === s ? "on" : ""}>
            {i + 1}. {t(STEP_KEYS[s])}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <UploadStep
          onReady={(j, hdrs) => {
            setJob(j);
            setHeaders(hdrs);
            setStep("map");
          }}
        />
      )}
      {step === "map" && job && (
        <MapStep
          job={job}
          headers={headers}
          onValidated={(p) => {
            setPreview(p);
            setJob(p.job);
            setStep("preview");
          }}
        />
      )}
      {step === "preview" && job && preview && (
        <PreviewStep
          preview={preview}
          onExecuted={(p) => {
            setPreview(p);
            setJob(p.job);
            setStep("done");
          }}
        />
      )}
      {step === "done" && preview && <DoneStep preview={preview} />}
    </section>
  );
}

function detectHeaders(csv: string): string[] {
  const firstLine = csv.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return firstLine
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function UploadStep({ onReady }: { onReady: (job: ImportJob, headers: string[]) => void }): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const cmd = useCommand();
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("animais.csv");
  const [farmId, setFarmId] = useState("");

  const submit = (): void => {
    void cmd.run(async () => {
      const uploaded = await client.imports.upload({ importType: "animals", content, filename, ...(farmId ? { farmId } : {}) });
      const parsed = await client.imports.parse(uploaded.id);
      onReady(parsed, detectHeaders(content));
    }, t("imports.uploadMsg"));
  };

  return (
    <div className="form" style={{ maxWidth: 720 }}>
      <h3>{t("imports.uploadTitle")}</h3>
      <label className="field">
        <span>{t("imports.csvLabel")}</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder={"tag,gender,breed,born\nBR-0100,female,BRANGUS,2024-05-01"}
          style={{ fontFamily: "monospace", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}
        />
      </label>
      <Field label={t("imports.filename")} value={filename} onChange={setFilename} />
      <Field label={t("imports.farmId")} value={farmId} onChange={setFarmId} placeholder={t("imports.farmPlaceholder")} />
      <button type="button" disabled={cmd.busy || !content.trim() || !farmId} onClick={submit}>
        {t("imports.uploadBtn")}
      </button>
      <FormMessage state={cmd} />
    </div>
  );
}

const TARGETS: { key: keyof AnimalImportMapping; labelKey: string; required?: boolean }[] = [
  { key: "visualId", labelKey: "imports.targetVisual", required: true },
  { key: "sex", labelKey: "imports.targetSex", required: true },
  { key: "breedCode", labelKey: "imports.targetBreed" },
  { key: "birthDate", labelKey: "imports.targetBirth" },
  { key: "rfid", labelKey: "imports.targetRfid" },
];

function MapStep({ job, headers, onValidated }: { job: ImportJob; headers: string[]; onValidated: (p: ImportPreview) => void }): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const cmd = useCommand();
  const guess = (target: string): string => headers.find((h) => h.toLowerCase().includes(target.toLowerCase())) ?? "";
  const [mapping, setMapping] = useState<Record<string, string>>({
    visualId: guess("tag") || guess("visual") || headers[0] || "",
    sex: guess("sex") || guess("gender") || "",
    breedCode: guess("breed") || "",
    birthDate: guess("born") || guess("birth") || "",
    rfid: guess("rfid") || "",
  });

  const options = [{ value: "", label: t("imports.noMap") }, ...headers.map((h) => ({ value: h, label: h }))];

  const submit = (): void => {
    void cmd.run(async () => {
      const clean: AnimalImportMapping = { visualId: mapping.visualId!, sex: mapping.sex! };
      if (mapping.breedCode) clean.breedCode = mapping.breedCode;
      if (mapping.birthDate) clean.birthDate = mapping.birthDate;
      if (mapping.rfid) clean.rfid = mapping.rfid;
      await client.imports.map(job.id, clean);
      await client.imports.validate(job.id);
      onValidated(await client.imports.preview(job.id));
    }, t("imports.mappedMsg"));
  };

  return (
    <div className="form" style={{ maxWidth: 560 }}>
      <h3>{t("imports.mapTitle", { n: job.totalRows })}</h3>
      {TARGETS.map((target) => (
        <SelectField
          key={target.key}
          label={`${t(target.labelKey)}${target.required ? " *" : ""}`}
          value={mapping[target.key] ?? ""}
          onChange={(v) => setMapping((m) => ({ ...m, [target.key]: v }))}
          options={options}
        />
      ))}
      <button type="button" disabled={cmd.busy || !mapping.visualId || !mapping.sex} onClick={submit}>
        {t("imports.validate")}
      </button>
      <FormMessage state={cmd} />
    </div>
  );
}

function PreviewStep({ preview, onExecuted }: { preview: ImportPreview; onExecuted: (p: ImportPreview) => void }): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const cmd = useCommand();
  const { job } = preview;

  const run = (): void => {
    void cmd.run(async () => {
      await client.imports.execute(job.id);
      onExecuted(await client.imports.reconcile(job.id));
    }, t("imports.executedMsg"));
  };

  return (
    <div>
      <div className="counts">
        <span className="badge">{t("imports.total", { n: job.totalRows })}</span>
        <span className="badge risk-low">{t("imports.valid", { n: job.validRows })}</span>
        <span className="badge risk-medium">{t("imports.duplicate", { n: job.duplicateRows })}</span>
        <span className="badge risk-high">{t("imports.invalid", { n: job.invalidRows })}</span>
      </div>

      {preview.sample.length > 0 && (
        <>
          <h3>{t("imports.previewValid")}</h3>
          <RowsTable rows={preview.sample} />
        </>
      )}
      {preview.invalidSample.length > 0 && (
        <>
          <h3>{t("imports.notImported")}</h3>
          <table className="grid">
            <thead>
              <tr>
                <th>{t("imports.colRow")}</th>
                <th>{t("imports.colSituation")}</th>
                <th>{t("imports.colReason")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.invalidSample.map((r) => (
                <tr key={r.rowNumber}>
                  <td>{r.rowNumber}</td>
                  <td>{r.validationStatus}</td>
                  <td>{r.errors.map((e) => `${e.field}: ${e.reason}`).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="form" style={{ marginTop: "1rem" }}>
        <button type="button" disabled={cmd.busy || job.validRows === 0} onClick={run}>
          {t("imports.executeBtn", { n: job.validRows })}
        </button>
        <FormMessage state={cmd} />
      </div>
    </div>
  );
}

function DoneStep({ preview }: { preview: ImportPreview }): JSX.Element {
  const { t } = useI18n();
  const { job } = preview;
  return (
    <div>
      <div className="counts">
        <span className="badge risk-low">{t("imports.created", { n: job.executedRows })}</span>
        {job.failedRows > 0 && <span className="badge risk-high">{t("imports.failures", { n: job.failedRows })}</span>}
        <span className="badge">{t("imports.statusBadge", { s: job.status })}</span>
      </div>
      {preview.sample.length > 0 && (
        <>
          <h3>{t("imports.createdTitle")}</h3>
          <RowsTable rows={preview.sample} showServerId />
        </>
      )}
      <p className="muted">{t("imports.reconciled")}</p>
    </div>
  );
}

function RowsTable({ rows, showServerId }: { rows: ImportPreview["sample"]; showServerId?: boolean }): JSX.Element {
  const { t } = useI18n();
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>{t("imports.colRow")}</th>
          <th>{t("imports.colVisual")}</th>
          <th>{t("imports.colSex")}</th>
          <th>{t("imports.colBreed")}</th>
          {showServerId && <th>{t("imports.colCreatedId")}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.rowNumber}>
            <td>{r.rowNumber}</td>
            <td>{String(r.mapped?.visualId ?? "—")}</td>
            <td>{String(r.mapped?.sex ?? "—")}</td>
            <td>{String(r.mapped?.breedCode ?? "—")}</td>
            {showServerId && <td>{r.serverId ? r.serverId.slice(0, 8) + "…" : "—"}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
