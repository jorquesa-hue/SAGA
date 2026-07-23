import { createHash } from "node:crypto";
import {
  createEventEnvelope,
  newUuid,
  NotFoundError,
  ValidationError,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import { appendEvent, withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { z } from "zod";
import { decide, loadCallerMemberships } from "./authorization.js";
import { parseCsv } from "./csv.js";
import {
  animalMappingSchema,
  animalRowSchema,
  IMPORT_TYPES,
  type AnimalMapping,
  type ImportJobSummary,
  type ImportPreview,
  type ImportRowView,
  type RowError,
  type RowExecutor,
} from "./domain.js";
import { ImportForbiddenError, ImportStateError } from "./errors.js";

/**
 * Staged import workflow (§27): upload → parse → map → validate → preview →
 * execute → reconcile. Raw content is preserved as evidence. Domain writes at
 * the execute stage are delegated to an injected {@link RowExecutor} backed by
 * the owning module's service, so this feature never writes another module's
 * tables directly (module boundaries hold).
 */

export const IMPORT_STARTED = "import.import_started.v1";
export const IMPORT_EXECUTED = "import.import_executed.v1";

const uploadInputSchema = z
  .object({
    importType: z.enum(IMPORT_TYPES),
    filename: z.string().max(400).optional(),
    content: z.string().min(1, "uploaded content is empty"),
    farmId: z.string().uuid().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type UploadImportInput = z.input<typeof uploadInputSchema>;

export interface ImportServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

export class ImportService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: ImportServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  /** Stage 1 — upload: persist the raw file as evidence and open the job. */
  async upload(context: TenantContext, rawInput: UploadImportInput): Promise<ImportJobSummary> {
    const input = parse(uploadInputSchema, rawInput);
    return this.write(context, async (client) => {
      const id = newUuid();
      const checksum = createHash("sha256").update(input.content).digest("hex");
      const append = await appendEvent(
        client,
        createEventEnvelope({
          eventType: IMPORT_STARTED,
          context,
          aggregateType: "import_job",
          aggregateId: id,
          aggregateVersion: 1,
          source: { channel: "system" },
          idempotencyKey: input.idempotencyKey ?? `import-${id}`,
          payload: { importId: id, importType: input.importType },
        }),
        { environment: this.environment },
      );
      await client.query(
        `INSERT INTO import_job (id, tenant_id, farm_id, import_type, status, filename, raw_content, raw_checksum, created_by, event_id)
         VALUES ($1,$2,$3,$4,'uploaded',$5,$6,$7,$8,$9)`,
        [id, context.tenantId, input.farmId ?? null, input.importType, input.filename ?? null, input.content, checksum, actorRef(context), append.eventId],
      );
      return this.summary(await this.loadJob(client, id));
    });
  }

  /** Stage 2 — parse: tokenize the CSV into staged rows. */
  async parse(context: TenantContext, jobId: Uuid): Promise<ImportJobSummary> {
    return this.write(context, async (client) => {
      const job = await this.loadJob(client, jobId);
      this.expect(job.status, ["uploaded"], "parse");
      const { rows } = parseCsv(job.raw_content);
      for (let i = 0; i < rows.length; i++) {
        await client.query(
          `INSERT INTO import_row (tenant_id, import_job_id, row_number, raw)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (import_job_id, row_number) DO NOTHING`,
          [context.tenantId, jobId, i + 1, JSON.stringify(rows[i])],
        );
      }
      await client.query(`UPDATE import_job SET status = 'parsed', total_rows = $2 WHERE id = $1`, [jobId, rows.length]);
      return this.summary(await this.loadJob(client, jobId));
    });
  }

  /** Stage 3 — map: apply a target-field → source-column mapping to each row. */
  async map(context: TenantContext, jobId: Uuid, rawMapping: AnimalMapping): Promise<ImportJobSummary> {
    const mapping = parse(animalMappingSchema, rawMapping);
    return this.write(context, async (client) => {
      const job = await this.loadJob(client, jobId);
      this.expect(job.status, ["parsed", "mapped", "validated"], "map");
      const rows = await this.loadRows(client, jobId);
      for (const row of rows) {
        const raw = row.raw as Record<string, string>;
        const mapped: Record<string, string> = {};
        for (const [target, source] of Object.entries(mapping)) {
          if (source && raw[source] !== undefined) mapped[target] = raw[source];
        }
        await client.query(
          `UPDATE import_row SET mapped = $3, validation_status = 'pending', errors = '[]'::jsonb WHERE import_job_id = $1 AND row_number = $2`,
          [jobId, row.row_number, JSON.stringify(mapped)],
        );
      }
      await client.query(`UPDATE import_job SET status = 'mapped', mapping = $2 WHERE id = $1`, [jobId, JSON.stringify(mapping)]);
      return this.summary(await this.loadJob(client, jobId));
    });
  }

  /** Stage 4 — validate: schema-check each mapped row and flag duplicates. */
  async validate(context: TenantContext, jobId: Uuid): Promise<ImportJobSummary> {
    return this.write(context, async (client) => {
      const job = await this.loadJob(client, jobId);
      this.expect(job.status, ["mapped", "validated"], "validate");
      const rows = await this.loadRows(client, jobId);

      const seenVisualIds = new Set<string>();
      let valid = 0;
      let invalid = 0;
      let duplicate = 0;

      for (const row of rows) {
        const mapped = (row.mapped ?? {}) as Record<string, unknown>;
        const result = animalRowSchema.safeParse(mapped);
        let status: "valid" | "invalid" | "duplicate" = "valid";
        let errors: RowError[] = [];

        if (!result.success) {
          status = "invalid";
          errors = result.error.issues.map((i) => ({ field: i.path.join(".") || "row", reason: i.message }));
        } else {
          const visualId = result.data.visualId;
          const inFile = seenVisualIds.has(visualId.toLowerCase());
          const inDb = await this.animalExists(client, visualId);
          if (inFile || inDb) {
            status = "duplicate";
            errors = [{ field: "visualId", reason: inFile ? "duplicate within file" : "already exists" }];
          } else {
            seenVisualIds.add(visualId.toLowerCase());
          }
        }
        if (status === "valid") valid++;
        else if (status === "duplicate") duplicate++;
        else invalid++;

        await client.query(
          `UPDATE import_row SET validation_status = $3, errors = $4 WHERE import_job_id = $1 AND row_number = $2`,
          [jobId, row.row_number, status, JSON.stringify(errors)],
        );
      }
      await client.query(
        `UPDATE import_job SET status = 'validated', valid_rows = $2, invalid_rows = $3, duplicate_rows = $4 WHERE id = $1`,
        [jobId, valid, invalid, duplicate],
      );
      return this.summary(await this.loadJob(client, jobId));
    });
  }

  /** Stage 5 — preview: summary + a sample of valid and invalid rows. */
  async preview(context: TenantContext, jobId: Uuid, sampleSize = 10): Promise<ImportPreview> {
    return this.read(context, async (client) => {
      const job = await this.loadJob(client, jobId);
      const rows = await this.loadRows(client, jobId);
      const views = rows.map(toRowView);
      return {
        job: this.summary(job),
        sample: views.filter((r) => r.validationStatus === "valid").slice(0, sampleSize),
        invalidSample: views.filter((r) => r.validationStatus !== "valid" && r.validationStatus !== "pending").slice(0, sampleSize),
      };
    });
  }

  /**
   * Stage 6 — execute: create a domain record for each VALID row via the
   * injected executor (duplicates/invalid rows are skipped, never guessed).
   * Runs in one transaction so the reconciliation counts commit atomically.
   */
  async execute(context: TenantContext, jobId: Uuid, executor: RowExecutor): Promise<ImportJobSummary> {
    return this.write(context, async (client) => {
      const job = await this.loadJob(client, jobId);
      this.expect(job.status, ["validated"], "execute");
      const rows = await this.loadRows(client, jobId);

      let executed = 0;
      let failed = 0;
      for (const row of rows) {
        if (row.validation_status !== "valid") {
          await client.query(
            `UPDATE import_row SET execution_status = 'skipped' WHERE import_job_id = $1 AND row_number = $2`,
            [jobId, row.row_number],
          );
          continue;
        }
        const parsed = animalRowSchema.parse(row.mapped);
        const result = await executor(parsed, { farmId: job.farm_id });
        if (result.status === "created") executed++;
        else if (result.status === "failed") failed++;
        await client.query(
          `UPDATE import_row SET execution_status = $3, server_id = $4, execution_error = $5 WHERE import_job_id = $1 AND row_number = $2`,
          [jobId, row.row_number, result.status, result.serverId ?? null, result.error ?? null],
        );
      }

      await appendEvent(
        client,
        createEventEnvelope({
          eventType: IMPORT_EXECUTED,
          context,
          aggregateType: "import_job",
          aggregateId: jobId,
          aggregateVersion: 2,
          source: { channel: "system" },
          idempotencyKey: `import-exec-${jobId}`,
          payload: { importId: jobId, executed, failed },
        }),
        { environment: this.environment },
      );
      await client.query(
        `UPDATE import_job SET status = 'executed', executed_rows = $2, failed_rows = $3 WHERE id = $1`,
        [jobId, executed, failed],
      );
      return this.summary(await this.loadJob(client, jobId));
    });
  }

  /** Stage 7 — reconcile: the final report (status → reconciled). */
  async reconcile(context: TenantContext, jobId: Uuid): Promise<ImportPreview> {
    return this.write(context, async (client) => {
      const job = await this.loadJob(client, jobId);
      this.expect(job.status, ["executed", "reconciled"], "reconcile");
      await client.query(`UPDATE import_job SET status = 'reconciled' WHERE id = $1`, [jobId]);
      const rows = await this.loadRows(client, jobId);
      const views = rows.map(toRowView);
      return {
        job: this.summary(await this.loadJob(client, jobId)),
        sample: views.filter((r) => r.executionStatus === "created").slice(0, 10),
        invalidSample: views.filter((r) => r.executionStatus === "failed").slice(0, 10),
      };
    });
  }

  async getJob(context: TenantContext, jobId: Uuid): Promise<ImportJobSummary> {
    return this.read(context, async (client) => this.summary(await this.loadJob(client, jobId)));
  }
  async listJobs(context: TenantContext): Promise<ImportJobSummary[]> {
    return this.read(context, async (client) => {
      const result = await client.query<JobRow>(`SELECT * FROM import_job ORDER BY created_at DESC`);
      return result.rows.map((r) => this.summary(r));
    });
  }

  // -- internals --
  private expect(status: string, allowed: string[], stage: string): void {
    if (!allowed.includes(status)) {
      throw new ImportStateError(`cannot ${stage} an import in status '${status}' (expected ${allowed.join("/")})`);
    }
  }

  private async animalExists(client: pg.PoolClient, visualId: string): Promise<boolean> {
    const r = await client.query(`SELECT 1 FROM animal WHERE visual_id = $1 LIMIT 1`, [visualId]);
    return r.rows.length > 0;
  }

  private async loadJob(client: pg.PoolClient, id: string): Promise<JobRow> {
    const r = await client.query<JobRow>(`SELECT * FROM import_job WHERE id = $1`, [id]);
    if (r.rows.length === 0) throw new NotFoundError(`Import ${id} not found`);
    return r.rows[0]!;
  }
  private async loadRows(client: pg.PoolClient, jobId: string): Promise<RowRow[]> {
    const r = await client.query<RowRow>(`SELECT * FROM import_row WHERE import_job_id = $1 ORDER BY row_number`, [jobId]);
    return r.rows;
  }

  private summary(job: JobRow): ImportJobSummary {
    return {
      id: job.id,
      importType: job.import_type,
      status: job.status,
      filename: job.filename,
      totalRows: job.total_rows,
      validRows: job.valid_rows,
      invalidRows: job.invalid_rows,
      duplicateRows: job.duplicate_rows,
      executedRows: job.executed_rows,
      failedRows: job.failed_rows,
    };
  }

  private async write<T>(context: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide("run_import", context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new ImportForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
  private async read<T>(context: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide("read", context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new ImportForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}

interface JobRow {
  id: Uuid;
  import_type: string;
  status: string;
  filename: string | null;
  farm_id: string | null;
  raw_content: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  executed_rows: number;
  failed_rows: number;
}
interface RowRow {
  row_number: number;
  raw: Record<string, unknown>;
  mapped: Record<string, unknown> | null;
  validation_status: string;
  errors: RowError[];
  execution_status: string;
  server_id: string | null;
  execution_error: string | null;
}

function toRowView(r: RowRow): ImportRowView {
  return {
    rowNumber: r.row_number,
    raw: r.raw,
    mapped: r.mapped,
    validationStatus: r.validation_status,
    errors: r.errors,
    executionStatus: r.execution_status,
    serverId: r.server_id,
    executionError: r.execution_error,
  };
}

function actorRef(context: TenantContext): string {
  return `${context.actor.type}:${context.actor.id}`;
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      "Invalid input",
      result.error.issues.map((i) => ({ field: i.path.join("."), reason: i.message })),
    );
  }
  return result.data;
}
