import { useState } from "react";
import type { AnimalImportMapping, ImportJob, ImportPreview } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

type Step = "upload" | "map" | "preview" | "done";

/**
 * Staged import wizard (§27): upload → map → validate → preview → execute →
 * reconcile. The server owns each stage; this drives it and shows the counts
 * and evidence at every step so nothing is imported blindly.
 */
export function Imports(): JSX.Element {
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
        <h2>Importar dados</h2>
        {job && (
          <button type="button" onClick={reset}>
            Nova importação
          </button>
        )}
      </div>

      <ol className="stepper">
        {(["upload", "map", "preview", "done"] as Step[]).map((s, i) => (
          <li key={s} className={step === s ? "on" : ""}>
            {i + 1}. {stepLabel(s)}
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

function stepLabel(s: Step): string {
  return { upload: "Enviar", map: "Mapear", preview: "Revisar", done: "Concluir" }[s];
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
  const cmd = useCommand();
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("animais.csv");
  const [farmId, setFarmId] = useState("");

  const submit = (): void => {
    void cmd.run(async () => {
      const uploaded = await client.imports.upload({ importType: "animals", content, filename, ...(farmId ? { farmId } : {}) });
      const parsed = await client.imports.parse(uploaded.id);
      onReady(parsed, detectHeaders(content));
    }, "Arquivo enviado e analisado");
  };

  return (
    <div className="form" style={{ maxWidth: 720 }}>
      <h3>1. Enviar CSV</h3>
      <label className="field">
        <span>Conteúdo CSV (cole aqui — a primeira linha é o cabeçalho)</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder={"tag,gender,breed,born\nBR-0100,female,BRANGUS,2024-05-01"}
          style={{ fontFamily: "monospace", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}
        />
      </label>
      <Field label="Nome do arquivo" value={filename} onChange={setFilename} />
      <Field label="Fazenda ID (destino dos animais)" value={farmId} onChange={setFarmId} placeholder="farm uuid" />
      <button type="button" disabled={cmd.busy || !content.trim() || !farmId} onClick={submit}>
        Enviar e analisar
      </button>
      <FormMessage state={cmd} />
    </div>
  );
}

const TARGETS: { key: keyof AnimalImportMapping; label: string; required?: boolean }[] = [
  { key: "visualId", label: "ID visual", required: true },
  { key: "sex", label: "Sexo", required: true },
  { key: "breedCode", label: "Raça" },
  { key: "birthDate", label: "Nascimento" },
  { key: "rfid", label: "RFID" },
];

function MapStep({ job, headers, onValidated }: { job: ImportJob; headers: string[]; onValidated: (p: ImportPreview) => void }): JSX.Element {
  const client = useClient();
  const cmd = useCommand();
  const guess = (t: string): string => headers.find((h) => h.toLowerCase().includes(t.toLowerCase())) ?? "";
  const [mapping, setMapping] = useState<Record<string, string>>({
    visualId: guess("tag") || guess("visual") || headers[0] || "",
    sex: guess("sex") || guess("gender") || "",
    breedCode: guess("breed") || "",
    birthDate: guess("born") || guess("birth") || "",
    rfid: guess("rfid") || "",
  });

  const options = [{ value: "", label: "— não mapear —" }, ...headers.map((h) => ({ value: h, label: h }))];

  const submit = (): void => {
    void cmd.run(async () => {
      const clean: AnimalImportMapping = { visualId: mapping.visualId!, sex: mapping.sex! };
      if (mapping.breedCode) clean.breedCode = mapping.breedCode;
      if (mapping.birthDate) clean.birthDate = mapping.birthDate;
      if (mapping.rfid) clean.rfid = mapping.rfid;
      await client.imports.map(job.id, clean);
      await client.imports.validate(job.id);
      onValidated(await client.imports.preview(job.id));
    }, "Mapeado e validado");
  };

  return (
    <div className="form" style={{ maxWidth: 560 }}>
      <h3>2. Mapear colunas ({job.totalRows} linhas)</h3>
      {TARGETS.map((t) => (
        <SelectField
          key={t.key}
          label={`${t.label}${t.required ? " *" : ""}`}
          value={mapping[t.key] ?? ""}
          onChange={(v) => setMapping((m) => ({ ...m, [t.key]: v }))}
          options={options}
        />
      ))}
      <button type="button" disabled={cmd.busy || !mapping.visualId || !mapping.sex} onClick={submit}>
        Validar
      </button>
      <FormMessage state={cmd} />
    </div>
  );
}

function PreviewStep({ preview, onExecuted }: { preview: ImportPreview; onExecuted: (p: ImportPreview) => void }): JSX.Element {
  const client = useClient();
  const cmd = useCommand();
  const { job } = preview;

  const run = (): void => {
    void cmd.run(async () => {
      await client.imports.execute(job.id);
      onExecuted(await client.imports.reconcile(job.id));
    }, "Importação executada");
  };

  return (
    <div>
      <div className="counts">
        <span className="badge">total {job.totalRows}</span>
        <span className="badge risk-low">válidas {job.validRows}</span>
        <span className="badge risk-medium">duplicadas {job.duplicateRows}</span>
        <span className="badge risk-high">inválidas {job.invalidRows}</span>
      </div>

      {preview.sample.length > 0 && (
        <>
          <h3>Prévia — válidas</h3>
          <RowsTable rows={preview.sample} />
        </>
      )}
      {preview.invalidSample.length > 0 && (
        <>
          <h3>Não serão importadas</h3>
          <table className="grid">
            <thead>
              <tr>
                <th>Linha</th>
                <th>Situação</th>
                <th>Motivo</th>
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
          Executar importação ({job.validRows})
        </button>
        <FormMessage state={cmd} />
      </div>
    </div>
  );
}

function DoneStep({ preview }: { preview: ImportPreview }): JSX.Element {
  const { job } = preview;
  return (
    <div>
      <div className="counts">
        <span className="badge risk-low">criadas {job.executedRows}</span>
        {job.failedRows > 0 && <span className="badge risk-high">falhas {job.failedRows}</span>}
        <span className="badge">status {job.status}</span>
      </div>
      {preview.sample.length > 0 && (
        <>
          <h3>Registros criados</h3>
          <RowsTable rows={preview.sample} showServerId />
        </>
      )}
      <p className="muted">Importação reconciliada. O arquivo enviado fica arquivado como evidência.</p>
    </div>
  );
}

function RowsTable({ rows, showServerId }: { rows: ImportPreview["sample"]; showServerId?: boolean }): JSX.Element {
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Linha</th>
          <th>ID visual</th>
          <th>Sexo</th>
          <th>Raça</th>
          {showServerId && <th>ID criado</th>}
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

