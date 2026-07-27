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
import { decide, loadCallerMemberships } from "./authorization.js";
import { ReportingForbiddenError, UnknownReportError } from "./errors.js";
import {
  findReport,
  REPORT_DEFINITIONS,
  type NormalizedParams,
  type ReportColumn,
  type ReportDefinition,
  type ReportParamSpec,
} from "./catalog.js";
import { reportRowsToCsv } from "./csv.js";

/**
 * Reporting service (§26, §47, §59).
 *
 * A report run is a READ that leaves an immutable trace: it projects the answer
 * from authoritative records, then records the exact result as an append-only
 * snapshot in `report_run` and emits `reporting.report_generated.v1` through
 * the transactional outbox. The snapshot makes a run reproducible and auditable
 * — you can reopen precisely what a report said when it was run, even as the
 * underlying append-only records grow.
 */

export const REPORT_GENERATED = "reporting.report_generated.v1";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReportCatalogItem {
  key: string;
  category: string;
  titleKey: string;
  descriptionKey: string;
  params: ReportParamSpec[];
  columns: ReportColumn[];
}

export interface ReportRunResult {
  id: Uuid;
  reportKey: string;
  category: string;
  titleKey: string;
  columns: ReportColumn[];
  params: Record<string, unknown>;
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
  rowCount: number;
  checksum: string;
  generatedAt: string;
}

export interface ReportRunSummary {
  id: Uuid;
  reportKey: string;
  rowCount: number;
  summary: Record<string, unknown>;
  checksum: string;
  generatedAt: string;
}

export interface ReportPreviewResult {
  reportKey: string;
  category: string;
  titleKey: string;
  columns: ReportColumn[];
  params: Record<string, unknown>;
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
  rowCount: number;
}

export interface RunReportInput {
  reportKey: string;
  params?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface ReportRunDownload {
  content: string;
  checksum: string;
  filename: string;
}

export interface ReportingServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

export class ReportingService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: ReportingServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  /** The report catalogue available to the caller (§26). */
  async listReports(context: TenantContext): Promise<ReportCatalogItem[]> {
    return this.authorized(context, async () =>
      REPORT_DEFINITIONS.map((d) => toCatalogItem(d)),
    );
  }

  /**
   * Preview a report without recording it (§47). A pure read over authoritative
   * records — no ledger row, no event — used for interactive exploration before
   * a caller commits an auditable snapshot with {@link runReport}.
   */
  async previewReport(
    context: TenantContext,
    input: RunReportInput,
  ): Promise<ReportPreviewResult> {
    const def = findReport(input.reportKey);
    if (!def) throw new UnknownReportError(`Unknown report ${input.reportKey}`);
    const params = normalizeParams(def, input.params ?? {});
    const appliedParams = appliedFrom(params);
    return this.authorized(context, async (client) => {
      const output = await def.run(client, params);
      return {
        reportKey: def.key,
        category: def.category,
        titleKey: def.titleKey,
        columns: def.columns,
        params: appliedParams,
        rows: output.rows,
        summary: output.summary,
        rowCount: output.rows.length,
      };
    });
  }

  /**
   * Run a report and record its result as an append-only snapshot (§26, §47).
   * Returns the freshly computed result plus its stable run id and checksum.
   */
  async runReport(
    context: TenantContext,
    input: RunReportInput,
  ): Promise<ReportRunResult> {
    const def = findReport(input.reportKey);
    if (!def) throw new UnknownReportError(`Unknown report ${input.reportKey}`);
    const params = normalizeParams(def, input.params ?? {});
    const appliedParams = appliedFrom(params);

    return this.authorized(context, async (client) => {
      const output = await def.run(client, params);
      const rowCount = output.rows.length;
      const checksum = createHash("sha256")
        .update(
          JSON.stringify({
            reportKey: def.key,
            params: appliedParams,
            rows: output.rows,
            summary: output.summary,
          }),
        )
        .digest("hex");

      const id = newUuid();
      // Append the event first so the row can carry its event id in a single
      // insert — report_run is append-only (no UPDATE) like the finance ledger.
      const append = await appendEvent(
        client,
        createEventEnvelope({
          eventType: REPORT_GENERATED,
          context,
          aggregateType: "report_run",
          aggregateId: id,
          aggregateVersion: 1,
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `report-run-${id}`,
          payload: { reportKey: def.key, rowCount, checksum },
        }),
        { environment: this.environment },
      );

      const inserted = await client.query<{ generated_at: Date }>(
        `INSERT INTO report_run
           (id, tenant_id, report_key, params, row_count, summary, result, checksum, requested_by, event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING generated_at`,
        [
          id,
          context.tenantId,
          def.key,
          JSON.stringify(appliedParams),
          rowCount,
          JSON.stringify(output.summary),
          JSON.stringify(output.rows),
          checksum,
          actorRef(context),
          append.eventId,
        ],
      );

      return {
        id,
        reportKey: def.key,
        category: def.category,
        titleKey: def.titleKey,
        columns: def.columns,
        params: appliedParams,
        rows: output.rows,
        summary: output.summary,
        rowCount,
        checksum,
        generatedAt: inserted.rows[0]!.generated_at.toISOString(),
      };
    });
  }

  /** Recent report runs (history), newest first (§47). */
  async listRuns(
    context: TenantContext,
    filter: { reportKey?: string; limit?: number } = {},
  ): Promise<ReportRunSummary[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return this.authorized(context, async (client) => {
      const result = await client.query<RunRow>(
        `SELECT id, report_key, row_count, summary, checksum, generated_at
           FROM report_run
          WHERE ($1::text IS NULL OR report_key = $1)
          ORDER BY generated_at DESC
          LIMIT $2`,
        [filter.reportKey ?? null, limit],
      );
      return result.rows.map((r) => ({
        id: r.id,
        reportKey: r.report_key,
        rowCount: r.row_count,
        summary: asObject(r.summary),
        checksum: r.checksum,
        generatedAt: new Date(r.generated_at).toISOString(),
      }));
    });
  }

  /** Reopen a past run's immutable snapshot (§47). */
  async getRun(context: TenantContext, id: Uuid): Promise<ReportRunResult> {
    return this.authorized(context, async (client) => this.loadRun(client, id));
  }

  /** Download a past run's snapshot as CSV (§27-adjacent, tenant-scoped). */
  async downloadRunCsv(context: TenantContext, id: Uuid): Promise<ReportRunDownload> {
    return this.authorized(context, async (client) => {
      const run = await this.loadRun(client, id);
      const content = reportRowsToCsv(run.columns, run.rows);
      const checksum = createHash("sha256").update(content).digest("hex");
      return { content, checksum, filename: `${run.reportKey}-${run.id}.csv` };
    });
  }

  // -- internals --
  private async loadRun(client: pg.PoolClient, id: Uuid): Promise<ReportRunResult> {
    const result = await client.query<RunRow>(
      `SELECT id, report_key, params, row_count, summary, result, checksum, generated_at
         FROM report_run WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) throw new NotFoundError(`Report run ${id} not found`);
    const r = result.rows[0]!;
    const def = findReport(r.report_key);
    return {
      id: r.id,
      reportKey: r.report_key,
      category: def?.category ?? "",
      titleKey: def?.titleKey ?? r.report_key,
      columns: def?.columns ?? [],
      params: asObject(r.params),
      rows: asArray(r.result),
      summary: asObject(r.summary),
      rowCount: r.row_count,
      checksum: r.checksum,
      generatedAt: new Date(r.generated_at).toISOString(),
    };
  }

  private async authorized<T>(
    context: TenantContext,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide(context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new ReportingForbiddenError(outcome.decision.reason);
    return outcome.value;
  }
}

interface RunRow {
  id: Uuid;
  report_key: string;
  params?: unknown;
  row_count: number;
  summary: unknown;
  result?: unknown;
  checksum: string;
  generated_at: Date | string;
}

function toCatalogItem(d: ReportDefinition): ReportCatalogItem {
  return {
    key: d.key,
    category: d.category,
    titleKey: d.titleKey,
    descriptionKey: d.descriptionKey,
    params: d.params,
    columns: d.columns,
  };
}

function normalizeParams(
  def: ReportDefinition,
  raw: Record<string, unknown>,
): NormalizedParams {
  const out: NormalizedParams = {
    farmId: null,
    lotId: null,
    dateFrom: null,
    dateTo: null,
  };
  for (const spec of def.params) {
    const value = raw[spec.key];
    if (value === undefined || value === null || value === "") continue;
    if (spec.kind === "farmId") out.farmId = asUuid(value, spec.key);
    else if (spec.kind === "lotId") out.lotId = asUuid(value, spec.key);
    else if (spec.kind === "dateFrom") out.dateFrom = asIso(value, spec.key);
    else if (spec.kind === "dateTo") out.dateTo = asIso(value, spec.key);
  }
  return out;
}

function appliedFrom(params: NormalizedParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (params.farmId) out.farmId = params.farmId;
  if (params.lotId) out.lotId = params.lotId;
  if (params.dateFrom) out.dateFrom = params.dateFrom;
  if (params.dateTo) out.dateTo = params.dateTo;
  return out;
}

function asUuid(value: unknown, field: string): string {
  const s = String(value);
  if (!UUID_RE.test(s)) {
    throw new ValidationError("Invalid parameter", [{ field, reason: "must be a UUID" }]);
  }
  return s;
}

function asIso(value: unknown, field: string): string {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError("Invalid parameter", [{ field, reason: "must be a date" }]);
  }
  return d.toISOString();
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }
  return {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    } catch {
      /* fall through */
    }
  }
  return [];
}

function actorRef(context: TenantContext): string {
  return `${context.actor.type}:${context.actor.id}`;
}
