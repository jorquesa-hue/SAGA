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
import {
  decide,
  loadCallerMemberships,
  type HealthAction,
} from "./authorization.js";
import {
  batchTreatmentInputSchema,
  defineProtocolInputSchema,
  openCaseInputSchema,
  overrideRestrictionInputSchema,
  parseInput,
  recordTreatmentInputSchema,
  type AnimalRestriction,
  type BatchTreatmentInput,
  type DefineProtocolInput,
  type HealthCase,
  type HealthProtocol,
  type OpenCaseInput,
  type OverrideRestrictionInput,
  type RecordTreatmentInput,
  type SaleClearResult,
  type Treatment,
} from "./domain.js";
import { HealthForbiddenError } from "./errors.js";
import {
  CASE_OPENED,
  CASE_RESOLVED,
  RESTRICTION_LIFTED,
  RESTRICTION_STARTED,
  TREATMENT_ADMINISTERED,
  VACCINATION_ADMINISTERED,
} from "./events.js";

export interface HealthServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

interface TreatmentRow {
  id: string;
  tenant_id: string;
  animal_id: string;
  protocol_id: string | null;
  kind: Treatment["kind"];
  product_name: string;
  medicine_batch: string | null;
  dose: string | null;
  dose_unit: string | null;
  route: string | null;
  administered_by: string | null;
  administered_at: Date;
  withdrawal_until: Date | null;
  notes: string | null;
}

interface RestrictionRow {
  id: string;
  tenant_id: string;
  animal_id: string;
  restriction_type: AnimalRestriction["restrictionType"];
  source_treatment_id: string | null;
  reason: string | null;
  valid_from: Date;
  valid_to: Date | null;
  status: AnimalRestriction["status"];
}

function mapTreatment(row: TreatmentRow): Treatment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    animalId: row.animal_id,
    protocolId: row.protocol_id,
    kind: row.kind,
    productName: row.product_name,
    medicineBatch: row.medicine_batch,
    dose: row.dose === null ? null : Number(row.dose),
    doseUnit: row.dose_unit,
    route: row.route,
    administeredBy: row.administered_by,
    administeredAt: row.administered_at,
    withdrawalUntil: row.withdrawal_until,
    notes: row.notes,
  };
}

function mapRestriction(row: RestrictionRow): AnimalRestriction {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    animalId: row.animal_id,
    restrictionType: row.restriction_type,
    sourceTreatmentId: row.source_treatment_id,
    reason: row.reason,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    status: row.status,
  };
}

/**
 * Health and Laboratory application service (§13, §23). Records treatments with
 * medicine traceability; a withdrawal period generates a restriction that
 * blocks sale-clear until it expires or a documented override lifts it.
 */
export class HealthService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: HealthServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  async defineProtocol(context: TenantContext, rawInput: DefineProtocolInput): Promise<HealthProtocol> {
    const input = parseInput(defineProtocolInputSchema, rawInput, "defineProtocol input");
    return this.authorized(context, "manage_protocols", async (client) => {
      try {
        const inserted = await client.query(
          `INSERT INTO health_protocol (tenant_id, farm_id, name, species_code, applies_to, version, schedule)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id, tenant_id, farm_id, name, species_code, applies_to, version, schedule, status`,
          [
            context.tenantId,
            input.farmId ?? null,
            input.name,
            input.speciesCode,
            input.appliesTo ?? null,
            input.version,
            JSON.stringify(input.schedule),
          ],
        );
        const r = inserted.rows[0]!;
        return {
          id: r.id,
          tenantId: r.tenant_id,
          farmId: r.farm_id,
          name: r.name,
          speciesCode: r.species_code,
          appliesTo: r.applies_to,
          version: r.version,
          schedule: r.schedule,
          status: r.status,
        } satisfies HealthProtocol;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ValidationError(`Protocol '${input.name}' version ${input.version} already exists`);
        }
        throw error;
      }
    });
  }

  async recordTreatment(context: TenantContext, rawInput: RecordTreatmentInput): Promise<Treatment> {
    const input = parseInput(recordTreatmentInputSchema, rawInput, "recordTreatment input");
    return this.authorized(context, "record_treatment", async (client) => {
      return this.insertTreatment(client, context, input);
    });
  }

  /** Batch vaccination/treatment with per-animal result and exceptions (JK-HLT-003). */
  async batchTreatment(
    context: TenantContext,
    rawInput: BatchTreatmentInput,
  ): Promise<Array<{ animalId: Uuid; status: "administered" | "error"; treatmentId?: Uuid; reason?: string }>> {
    const input = parseInput(batchTreatmentInputSchema, rawInput, "batchTreatment input");
    return this.authorized(context, "record_treatment", async (client) => {
      const results: Array<{ animalId: Uuid; status: "administered" | "error"; treatmentId?: Uuid; reason?: string }> = [];
      for (const animalId of input.animalIds) {
        await client.query("SAVEPOINT tx_item");
        try {
          const treatment = await this.insertTreatment(client, context, { ...input, animalId });
          await client.query("RELEASE SAVEPOINT tx_item");
          results.push({ animalId, status: "administered", treatmentId: treatment.id });
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT tx_item");
          results.push({ animalId, status: "error", reason: (error as Error).message });
        }
      }
      return results;
    });
  }

  async listActiveRestrictions(context: TenantContext, animalId: Uuid): Promise<AnimalRestriction[]> {
    return this.authorized(context, "read", async (client) => {
      const result = await client.query<RestrictionRow>(
        `SELECT * FROM animal_restriction
         WHERE animal_id = $1 AND status = 'active' AND (valid_to IS NULL OR valid_to > now())
         ORDER BY valid_from DESC`,
        [animalId],
      );
      return result.rows.map(mapRestriction);
    });
  }

  /**
   * Sale-clear check (JK-HLT-005): an animal is NOT clear while any withdrawal
   * (or other active) restriction is in force. The result lists the blocking
   * restrictions so the UI can explain and offer a documented override.
   */
  async checkSaleClear(context: TenantContext, animalId: Uuid): Promise<SaleClearResult> {
    const active = await this.listActiveRestrictions(context, animalId);
    return { animalId, clear: active.length === 0, activeRestrictions: active };
  }

  /**
   * Lift a restriction with an authorized, documented override (JK-HLT-005).
   * Records who, when, and why; appends restriction_lifted. Requires an
   * override-capable role (veterinarian or tenant_owner).
   */
  async overrideRestriction(
    context: TenantContext,
    rawInput: OverrideRestrictionInput,
  ): Promise<AnimalRestriction> {
    const input = parseInput(overrideRestrictionInputSchema, rawInput, "overrideRestriction input");
    return this.authorized(context, "override_restriction", async (client) => {
      const current = await client.query<RestrictionRow>(
        `SELECT * FROM animal_restriction WHERE id = $1`,
        [input.restrictionId],
      );
      if (current.rows.length === 0) {
        throw new NotFoundError(`Restriction ${input.restrictionId} not found`);
      }
      if (current.rows[0]!.status !== "active") {
        throw new ValidationError(`Restriction ${input.restrictionId} is not active`);
      }
      const updated = await client.query<RestrictionRow>(
        `UPDATE animal_restriction
         SET status = 'overridden', lifted_by = $2, lifted_reason = $3, lifted_at = now()
         WHERE id = $1 RETURNING *`,
        [
          input.restrictionId,
          context.actor.type === "user" ? context.actor.id : null,
          input.reason,
        ],
      );
      const restriction = mapRestriction(updated.rows[0]!);
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: RESTRICTION_LIFTED,
          context,
          aggregateType: "animal",
          aggregateId: restriction.animalId,
          aggregateVersion: await this.nextAnimalVersion(client, context.tenantId, restriction.animalId),
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `restriction-override-${restriction.id}`,
          payload: {
            animalId: restriction.animalId,
            restrictionId: restriction.id,
            restrictionType: restriction.restrictionType,
            overrideReason: input.reason,
          },
        }),
        { environment: this.environment },
      );
      await this.audit(client, context, "health.restriction_overridden", "animal", restriction.animalId, "success", {
        restrictionId: restriction.id,
        reason: input.reason,
      });
      return restriction;
    });
  }

  async getAnimalTreatments(context: TenantContext, animalId: Uuid): Promise<Treatment[]> {
    return this.authorized(context, "read", async (client) => {
      const result = await client.query<TreatmentRow>(
        `SELECT * FROM treatment WHERE animal_id = $1 ORDER BY administered_at DESC`,
        [animalId],
      );
      return result.rows.map(mapTreatment);
    });
  }

  async openCase(context: TenantContext, rawInput: OpenCaseInput): Promise<HealthCase> {
    const input = parseInput(openCaseInputSchema, rawInput, "openCase input");
    return this.authorized(context, "manage_cases", async (client) => {
      await this.assertAnimalExists(client, input.animalId);
      const inserted = await client.query(
        `INSERT INTO health_case (tenant_id, animal_id, opened_by, symptom, diagnosis)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, tenant_id, animal_id, opened_at, symptom, diagnosis, status, outcome, closed_at`,
        [
          context.tenantId,
          input.animalId,
          context.actor.type === "user" ? context.actor.id : null,
          input.symptom ?? null,
          input.diagnosis ?? null,
        ],
      );
      const r = inserted.rows[0]!;
      const healthCase: HealthCase = {
        id: r.id,
        tenantId: r.tenant_id,
        animalId: r.animal_id,
        openedAt: r.opened_at,
        symptom: r.symptom,
        diagnosis: r.diagnosis,
        status: r.status,
        outcome: r.outcome,
        closedAt: r.closed_at,
      };
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: CASE_OPENED,
          context,
          aggregateType: "health_case",
          aggregateId: healthCase.id,
          aggregateVersion: 1,
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `case-open-${healthCase.id}`,
          payload: { caseId: healthCase.id, animalId: input.animalId, symptom: input.symptom ?? null },
        }),
        { environment: this.environment },
      );
      return healthCase;
    });
  }

  async resolveCase(context: TenantContext, caseId: Uuid, outcome: string): Promise<HealthCase> {
    return this.authorized(context, "manage_cases", async (client) => {
      const updated = await client.query(
        `UPDATE health_case SET status = 'resolved', outcome = $2, closed_at = now()
         WHERE id = $1 AND status = 'open'
         RETURNING id, tenant_id, animal_id, opened_at, symptom, diagnosis, status, outcome, closed_at`,
        [caseId, outcome],
      );
      if (updated.rows.length === 0) {
        throw new NotFoundError(`Open case ${caseId} not found`);
      }
      const r = updated.rows[0]!;
      const healthCase: HealthCase = {
        id: r.id,
        tenantId: r.tenant_id,
        animalId: r.animal_id,
        openedAt: r.opened_at,
        symptom: r.symptom,
        diagnosis: r.diagnosis,
        status: r.status,
        outcome: r.outcome,
        closedAt: r.closed_at,
      };
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: CASE_RESOLVED,
          context,
          aggregateType: "health_case",
          aggregateId: caseId,
          aggregateVersion: await this.nextCaseVersion(client, context.tenantId, caseId),
          source: { channel: "api" },
          idempotencyKey: `case-resolve-${caseId}`,
          payload: { caseId, animalId: healthCase.animalId, outcome },
        }),
        { environment: this.environment },
      );
      return healthCase;
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async insertTreatment(
    client: pg.PoolClient,
    context: TenantContext,
    input: ReturnType<typeof parseInput<typeof recordTreatmentInputSchema>> & { animalId: string },
  ): Promise<Treatment> {
    await this.assertAnimalExists(client, input.animalId);
    const administeredAt = new Date(input.administeredAt);
    const withdrawalUntil =
      input.withdrawalDays && input.withdrawalDays > 0
        ? new Date(administeredAt.getTime() + input.withdrawalDays * 86_400_000)
        : null;
    const treatmentId = newUuid();

    const inserted = await client.query<TreatmentRow>(
      `INSERT INTO treatment
         (id, tenant_id, animal_id, protocol_id, kind, product_name, medicine_batch,
          dose, dose_unit, route, administered_by, administered_at, withdrawal_until, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        treatmentId,
        context.tenantId,
        input.animalId,
        input.protocolId ?? null,
        input.kind,
        input.productName,
        input.medicineBatch ?? null,
        input.dose ?? null,
        input.doseUnit ?? null,
        input.route ?? null,
        context.actor.type === "user" ? context.actor.id : null,
        administeredAt.toISOString(),
        withdrawalUntil ? withdrawalUntil.toISOString() : null,
        input.notes ?? null,
      ],
    );
    const treatment = mapTreatment(inserted.rows[0]!);

    const version = await this.nextAnimalVersion(client, context.tenantId, input.animalId);
    const append = await appendEvent(
      client,
      createEventEnvelope({
        eventType: input.kind === "vaccination" ? VACCINATION_ADMINISTERED : TREATMENT_ADMINISTERED,
        context,
        aggregateType: "animal",
        aggregateId: input.animalId,
        aggregateVersion: version,
        occurredAt: administeredAt,
        source: { channel: "api" },
        idempotencyKey: input.idempotencyKey
          ? `${input.idempotencyKey}:${input.animalId}`
          : `treatment-${treatmentId}`,
        payload: {
          treatmentId,
          animalId: input.animalId,
          kind: input.kind,
          productName: input.productName,
          medicineBatch: input.medicineBatch ?? null,
          dose: input.dose ?? null,
          doseUnit: input.doseUnit ?? null,
          route: input.route ?? null,
          withdrawalUntil: withdrawalUntil ? withdrawalUntil.toISOString() : null,
        },
      }),
      { environment: this.environment },
    );
    await client.query(`UPDATE treatment SET event_id = $2 WHERE id = $1`, [treatmentId, append.eventId]);

    // JK-DOM-011: a treatment with a withdrawal period generates restriction
    // state with a due date, blocking sale-clear (JK-HLT-005).
    if (withdrawalUntil) {
      const restrictionId = newUuid();
      await client.query(
        `INSERT INTO animal_restriction
           (id, tenant_id, animal_id, restriction_type, source_treatment_id, reason, valid_from, valid_to, status)
         VALUES ($1,$2,$3,'withdrawal',$4,$5,$6,$7,'active')`,
        [
          restrictionId,
          context.tenantId,
          input.animalId,
          treatmentId,
          `withdrawal period for ${input.productName}`,
          administeredAt.toISOString(),
          withdrawalUntil.toISOString(),
        ],
      );
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: RESTRICTION_STARTED,
          context,
          aggregateType: "animal",
          aggregateId: input.animalId,
          aggregateVersion: await this.nextAnimalVersion(client, context.tenantId, input.animalId),
          occurredAt: administeredAt,
          source: { channel: "api" },
          idempotencyKey: `restriction-${restrictionId}`,
          payload: {
            animalId: input.animalId,
            restrictionId,
            restrictionType: "withdrawal",
            sourceTreatmentId: treatmentId,
            validUntil: withdrawalUntil.toISOString(),
          },
        }),
        { environment: this.environment },
      );
    }
    return treatment;
  }

  private async assertAnimalExists(client: pg.PoolClient, animalId: Uuid): Promise<void> {
    const result = await client.query(`SELECT 1 FROM animal WHERE id = $1`, [animalId]);
    if (result.rows.length === 0) throw new NotFoundError(`Animal ${animalId} not found`);
  }

  private async nextAnimalVersion(client: pg.PoolClient, tenantId: string, animalId: string): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event WHERE tenant_id = $1 AND aggregate_type = 'animal' AND aggregate_id = $2`,
      [tenantId, animalId],
    );
    return result.rows[0]!.next;
  }

  private async nextCaseVersion(client: pg.PoolClient, tenantId: string, caseId: string): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event WHERE tenant_id = $1 AND aggregate_type = 'health_case' AND aggregate_id = $2`,
      [tenantId, caseId],
    );
    return result.rows[0]!.next;
  }

  private async audit(
    client: pg.PoolClient,
    context: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string | null,
    outcome: "success" | "denied" | "error",
    detail: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_record
         (tenant_id, actor_type, actor_id, action, resource_type, resource_id, outcome, correlation_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        context.tenantId,
        context.actor.type,
        context.actor.id,
        action,
        resourceType,
        resourceId,
        outcome,
        context.correlationId,
        JSON.stringify(detail),
      ],
    );
  }

  private async authorized<T>(
    context: TenantContext,
    action: HealthAction,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide(action, memberships);
      if (!decision.allowed) {
        await this.audit(client, context, `health.${action}`, "animal", null, "denied", {
          reason: decision.reason,
        });
        return { ok: false as const, decision };
      }
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new HealthForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}
