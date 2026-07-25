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
import { AnalyticsForbiddenError } from "./errors.js";

/**
 * Secure exports (§27) and the animal traceability packet (JK-ANI-006).
 *
 * Exports are ASYNCHRONOUS (request → process → download), tenant-scoped,
 * time-limited (default 7 days), and audited on every state change and
 * download. The traceability packet assembles one animal's identity,
 * identifiers, weight history, health restrictions, and event timeline into a
 * machine-readable document rendered as JSON or CSV. A completed export is
 * resolvable by a stable id (the QR-resolvable link is the download path).
 */

export const EXPORT_REQUESTED = "export.export_requested.v1";
export const EXPORT_COMPLETED = "export.export_completed.v1";

export const EXPORT_TYPES = [
  "animal_traceability_packet",
  "animal_inventory",
  "herd_weights",
  "finance_ledger",
] as const;
export const EXPORT_FORMATS = ["json", "csv", "xlsx", "pdf", "geojson", "zip"] as const;

export const requestExportInputSchema = z
  .object({
    exportType: z.enum(EXPORT_TYPES),
    format: z.enum(EXPORT_FORMATS).default("json"),
    params: z.record(z.unknown()).default({}),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type RequestExportInput = z.input<typeof requestExportInputSchema>;

export interface ExportJob {
  id: Uuid;
  exportType: string;
  format: string;
  status: string;
  byteSize: number | null;
  checksum: string | null;
  expiresAt: string | null;
  /** QR-resolvable download link (JK-ANI-006). */
  resolvableUrl: string;
}

export interface ExportDownload {
  content: string;
  checksum: string;
  format: string;
  byteSize: number;
}

/**
 * Identifies the system that vouches for an export (docs/brand §4.2).
 *
 * The packet is the artefact a buyer or auditor carries away, so it has to
 * say what produced it and why it can be trusted. `appendOnly` is the
 * machine-readable form of §1.5 proof 01.
 */
export interface ExportProducer {
  product: "SAGA";
  record: string;
  specification: string;
  appendOnly: true;
  notice: string;
}

export const APPEND_ONLY_NOTICE =
  "Append-only extract: nothing is deleted. Corrections are filed as new " +
  "entries, each with its own date.";

export function exportProducer(record: string): ExportProducer {
  return {
    product: "SAGA",
    record,
    specification: "JK-PLT-EES-001",
    appendOnly: true,
    notice: APPEND_ONLY_NOTICE,
  };
}

export interface AnimalTraceabilityPacket {
  producer: ExportProducer;
  animal: Record<string, unknown>;
  identifiers: Record<string, unknown>[];
  weights: Record<string, unknown>[];
  restrictions: Record<string, unknown>[];
  timeline: Record<string, unknown>[];
  generatedAt: string;
}

export interface ExportServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

export class ExportService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: ExportServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  /** Start an asynchronous export job (§27). Audited; returns pending job. */
  async requestExport(
    context: TenantContext,
    rawInput: RequestExportInput,
  ): Promise<ExportJob> {
    const input = parse(requestExportInputSchema, rawInput);
    if (input.exportType === "animal_traceability_packet" && !input.params.animalId) {
      throw new ValidationError("animal_traceability_packet requires params.animalId");
    }
    return this.authorized("read", context, async (client) => {
      const id = newUuid();
      const append = await appendEvent(
        client,
        createEventEnvelope({
          eventType: EXPORT_REQUESTED,
          context,
          aggregateType: "export_job",
          aggregateId: id,
          aggregateVersion: 1,
          source: { channel: "system" },
          idempotencyKey: input.idempotencyKey ?? `export-${id}`,
          payload: { exportId: id, exportType: input.exportType, format: input.format },
        }),
        { environment: this.environment },
      );
      await client.query(
        `INSERT INTO export_job (id, tenant_id, requested_by, export_type, format, params, status, event_id)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
        [
          id,
          context.tenantId,
          actorRef(context),
          input.exportType,
          input.format,
          JSON.stringify(input.params),
          append.eventId,
        ],
      );
      await this.audit(client, context, id, "requested", {
        exportType: input.exportType,
        format: input.format,
      });
      return this.toJob(id, input.exportType, input.format, "pending", null, null, null);
    });
  }

  /**
   * Process a pending export: assemble the artifact, checksum it, and store it
   * with a time-limited download window. Idempotent — a non-pending job is a
   * no-op that returns the current state.
   */
  async processExport(context: TenantContext, id: Uuid): Promise<ExportJob> {
    return this.authorized("read", context, async (client) => {
      const job = await this.load(client, id);
      if (job.status !== "pending") return this.rowToJob(job);
      await client.query(
        `UPDATE export_job SET status = 'running', started_at = now() WHERE id = $1`,
        [id],
      );

      let content: string;
      try {
        content = await this.assemble(
          client,
          job.export_type,
          job.format,
          job.params ?? {},
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "assembly_failed";
        await client.query(
          `UPDATE export_job SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`,
          [id, message],
        );
        await this.audit(client, context, id, "failed", { error: message });
        throw e instanceof Error ? e : new Error(message);
      }

      const checksum = createHash("sha256").update(content).digest("hex");
      const byteSize = Buffer.byteLength(content, "utf8");
      await client.query(
        `UPDATE export_job
            SET status = 'completed', result_content = $2, result_checksum = $3, byte_size = $4, completed_at = now()
          WHERE id = $1`,
        [id, content, checksum, byteSize],
      );
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: EXPORT_COMPLETED,
          context,
          aggregateType: "export_job",
          aggregateId: id,
          aggregateVersion: 2,
          source: { channel: "system" },
          idempotencyKey: `export-done-${id}`,
          payload: { exportId: id, checksum, byteSize },
        }),
        { environment: this.environment },
      );
      await this.audit(client, context, id, "completed", { checksum, byteSize });
      return this.toJob(
        id,
        job.export_type,
        job.format,
        "completed",
        byteSize,
        checksum,
        job.expires_at,
      );
    });
  }

  /** Download a completed, non-expired export. Refuses and audits if expired. */
  async downloadExport(context: TenantContext, id: Uuid): Promise<ExportDownload> {
    // The expiry transition and its audit must COMMIT even though the request
    // is refused, so we mark + return a discriminated result and throw after.
    const outcome = await this.authorized("read", context, async (client) => {
      const job = await this.load(client, id);
      if (job.status !== "completed" || job.result_content === null) {
        return { kind: "unavailable" as const, status: job.status };
      }
      if (new Date(job.expires_at).getTime() <= Date.now()) {
        await client.query(`UPDATE export_job SET status = 'expired' WHERE id = $1`, [
          id,
        ]);
        await this.audit(client, context, id, "denied_expired", {});
        return { kind: "expired" as const };
      }
      await this.audit(client, context, id, "downloaded", { byteSize: job.byte_size });
      return {
        kind: "ok" as const,
        download: {
          content: job.result_content,
          checksum: job.result_checksum!,
          format: job.format,
          byteSize: job.byte_size ?? Buffer.byteLength(job.result_content, "utf8"),
        },
      };
    });

    if (outcome.kind === "unavailable") {
      throw new ValidationError(
        `Export ${id} is not available for download (status ${outcome.status})`,
      );
    }
    if (outcome.kind === "expired") {
      throw new ValidationError(`Export ${id} has expired`);
    }
    return outcome.download;
  }

  async getExportJob(context: TenantContext, id: Uuid): Promise<ExportJob> {
    return this.authorized("read", context, async (client) =>
      this.rowToJob(await this.load(client, id)),
    );
  }

  async listExportJobs(context: TenantContext, status?: string): Promise<ExportJob[]> {
    return this.authorized("read", context, async (client) => {
      const result = await client.query<ExportRow>(
        `SELECT * FROM export_job WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC`,
        [status ?? null],
      );
      return result.rows.map((r) => this.rowToJob(r));
    });
  }

  /**
   * Assemble one animal's traceability packet (JK-ANI-006). Reads identity,
   * identifiers, weights, active/historic restrictions, and the event timeline.
   */
  async buildAnimalTraceabilityPacket(
    client: pg.PoolClient,
    animalId: string,
  ): Promise<AnimalTraceabilityPacket> {
    const animal = await client.query(
      `SELECT id, visual_id, species_code, breed_code, sex, birth_date, lifecycle_status FROM animal WHERE id = $1`,
      [animalId],
    );
    if (animal.rows.length === 0) throw new NotFoundError(`Animal ${animalId} not found`);
    const identifiers = await client.query(
      `SELECT identifier_type, identifier_value, valid_from, valid_to FROM animal_identifier
        WHERE animal_id = $1 ORDER BY valid_from`,
      [animalId],
    );
    const weights = await client.query(
      `SELECT occurred_at, weight_kg, eligible_for_analytics FROM animal_weight
        WHERE animal_id = $1 ORDER BY occurred_at`,
      [animalId],
    );
    const restrictions = await client.query(
      `SELECT restriction_type, reason, valid_from, valid_to, status FROM animal_restriction
        WHERE animal_id = $1 ORDER BY valid_from`,
      [animalId],
    );
    const timeline = await client.query(
      `SELECT event_type, occurred_at, aggregate_version FROM domain_event
        WHERE aggregate_type = 'animal' AND aggregate_id = $1 ORDER BY occurred_at, aggregate_version`,
      [animalId],
    );
    return {
      producer: exportProducer("animal_traceability_packet"),
      animal: animal.rows[0]!,
      identifiers: identifiers.rows,
      weights: weights.rows,
      restrictions: restrictions.rows,
      timeline: timeline.rows,
      generatedAt: new Date().toISOString(),
    };
  }

  // -- internals --
  private async assemble(
    client: pg.PoolClient,
    exportType: string,
    format: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    if (exportType === "animal_traceability_packet") {
      const packet = await this.buildAnimalTraceabilityPacket(
        client,
        String(params.animalId),
      );
      return format === "csv"
        ? traceabilityToCsv(packet)
        : JSON.stringify(packet, null, 2);
    }
    if (exportType === "animal_inventory") {
      const rows = await client.query(
        `SELECT id, visual_id, sex, breed_code, lifecycle_status FROM animal ORDER BY visual_id`,
      );
      return format === "csv"
        ? rowsToCsv(rows.rows as Record<string, unknown>[])
        : JSON.stringify(rows.rows, null, 2);
    }
    if (exportType === "herd_weights") {
      const rows = await client.query(
        `SELECT animal_id, occurred_at, weight_kg FROM animal_weight ORDER BY occurred_at`,
      );
      return format === "csv"
        ? rowsToCsv(rows.rows as Record<string, unknown>[])
        : JSON.stringify(rows.rows, null, 2);
    }
    // finance_ledger
    const rows = await client.query(
      `SELECT id, entry_type, category, amount_minor, currency, occurred_at FROM financial_entry ORDER BY occurred_at`,
    );
    return format === "csv"
      ? rowsToCsv(rows.rows as Record<string, unknown>[])
      : JSON.stringify(rows.rows, null, 2);
  }

  private async load(client: pg.PoolClient, id: string): Promise<ExportRow> {
    const result = await client.query<ExportRow>(
      `SELECT * FROM export_job WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) throw new NotFoundError(`Export ${id} not found`);
    return result.rows[0]!;
  }

  private async audit(
    client: pg.PoolClient,
    context: TenantContext,
    exportJobId: string,
    action: "requested" | "completed" | "downloaded" | "denied_expired" | "failed",
    detail: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO export_access_log (tenant_id, export_job_id, action, actor_type, actor_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        context.tenantId,
        exportJobId,
        action,
        context.actor.type,
        context.actor.id,
        JSON.stringify(detail),
      ],
    );
  }

  private toJob(
    id: string,
    exportType: string,
    format: string,
    status: string,
    byteSize: number | null,
    checksum: string | null,
    expiresAt: string | Date | null,
  ): ExportJob {
    return {
      id,
      exportType,
      format,
      status,
      byteSize,
      checksum,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      resolvableUrl: `/api/v1/exports/${id}/download`,
    };
  }

  private rowToJob(row: ExportRow): ExportJob {
    return this.toJob(
      row.id,
      row.export_type,
      row.format,
      row.status,
      row.byte_size,
      row.result_checksum,
      row.expires_at,
    );
  }

  private async authorized<T>(
    action: "read",
    context: TenantContext,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide(action, context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok)
      throw new AnalyticsForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}

interface ExportRow {
  id: Uuid;
  export_type: string;
  format: string;
  status: string;
  params: Record<string, unknown> | null;
  result_content: string | null;
  result_checksum: string | null;
  byte_size: number | null;
  expires_at: string;
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

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  return lines.join("\n");
}

function traceabilityToCsv(packet: AnimalTraceabilityPacket): string {
  const sections: string[] = [];
  // The CSV is read outside SAGA, so it states its provenance too.
  sections.push(
    `# ${packet.producer.product} · ${packet.producer.record} · ${packet.producer.specification}`,
    `# generated ${packet.generatedAt}`,
    `# ${packet.producer.notice}`,
    "",
  );
  sections.push("# animal", rowsToCsv([packet.animal]));
  sections.push("# identifiers", rowsToCsv(packet.identifiers));
  sections.push("# weights", rowsToCsv(packet.weights));
  sections.push("# restrictions", rowsToCsv(packet.restrictions));
  sections.push("# timeline", rowsToCsv(packet.timeline));
  return sections.join("\n");
}
