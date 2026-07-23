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
  type ReproAction,
} from "./authorization.js";
import { defaultCalfRegistrar, type CalfRegistrar } from "./calf-registrar.js";
import {
  addDaysIsoDate,
  BOVINE_GESTATION_DAYS,
  parseInput,
  pregnancyCheckInputSchema,
  recordCalvingInputSchema,
  recordServiceInputSchema,
  type Calving,
  type PregnancyCheck,
  type PregnancyCheckInput,
  type RecordCalvingInput,
  type RecordServiceInput,
  type ReproductionService,
  type ReproductionState,
  type ReproductionStatus,
} from "./domain.js";
import { ReproForbiddenError } from "./errors.js";
import { CALVING_RECORDED, PREGNANCY_CHECKED, SERVICE_RECORDED } from "./events.js";

export interface ReproductionServiceOptions {
  appPool: pg.Pool;
  environment?: string;
  calfRegistrar?: CalfRegistrar;
}

/**
 * Reproduction and Genetics application service (§12, §21). Records services,
 * pregnancy checks, and calvings; calving may create/link a calf through the
 * CalfRegistrar port. Reproduction state is projected from these facts.
 */
export class ReproductionGeneticsService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;
  private readonly calfRegistrar: CalfRegistrar;

  constructor(options: ReproductionServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
    this.calfRegistrar = options.calfRegistrar ?? defaultCalfRegistrar;
  }

  async recordService(context: TenantContext, rawInput: RecordServiceInput): Promise<ReproductionService> {
    const input = parseInput(recordServiceInputSchema, rawInput, "recordService input");
    return this.authorized(context, "record_reproduction", async (client) => {
      await this.assertFemale(client, input.damId);
      const id = newUuid();
      const inserted = await client.query(
        `INSERT INTO reproduction_service
           (id, tenant_id, dam_id, method, service_date, bull_id, external_sire_ref, semen_batch, technician_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, tenant_id, dam_id, method, service_date, bull_id, external_sire_ref, semen_batch, technician_id`,
        [
          id,
          context.tenantId,
          input.damId,
          input.method,
          input.serviceDate,
          input.bullId ?? null,
          input.externalSireRef ?? null,
          input.semenBatch ?? null,
          input.technicianId ?? null,
          input.notes ?? null,
        ],
      );
      const append = await appendEvent(
        client,
        createEventEnvelope({
          eventType: SERVICE_RECORDED,
          context,
          aggregateType: "animal",
          aggregateId: input.damId,
          aggregateVersion: await this.nextAnimalVersion(client, context.tenantId, input.damId),
          occurredAt: new Date(input.serviceDate),
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `service-${id}`,
          payload: {
            serviceId: id,
            damId: input.damId,
            method: input.method,
            bullId: input.bullId ?? null,
            semenBatch: input.semenBatch ?? null,
          },
        }),
        { environment: this.environment },
      );
      await client.query(`UPDATE reproduction_service SET event_id = $2 WHERE id = $1`, [id, append.eventId]);
      const r = inserted.rows[0]!;
      return {
        id: r.id,
        tenantId: r.tenant_id,
        damId: r.dam_id,
        method: r.method,
        serviceDate: r.service_date,
        bullId: r.bull_id,
        externalSireRef: r.external_sire_ref,
        semenBatch: r.semen_batch,
        technicianId: r.technician_id,
      } satisfies ReproductionService;
    });
  }

  async recordPregnancyCheck(context: TenantContext, rawInput: PregnancyCheckInput): Promise<PregnancyCheck> {
    const input = parseInput(pregnancyCheckInputSchema, rawInput, "pregnancyCheck input");
    return this.authorized(context, "record_reproduction", async (client) => {
      await this.assertFemale(client, input.damId);

      // Expected calving date: from the linked (or latest) service date + gestation,
      // adjusted by a supplied gestation estimate when positive.
      let expectedCalvingDate: string | null = null;
      if (input.result === "positive") {
        const serviceDate = await this.serviceDateFor(client, input.damId, input.serviceId);
        if (serviceDate) {
          expectedCalvingDate = addDaysIsoDate(serviceDate.toISOString(), BOVINE_GESTATION_DAYS);
        } else if (input.gestationDaysEstimate != null) {
          const remaining = BOVINE_GESTATION_DAYS - input.gestationDaysEstimate;
          expectedCalvingDate = addDaysIsoDate(input.checkDate, Math.max(remaining, 0));
        }
      }

      const id = newUuid();
      const inserted = await client.query(
        `INSERT INTO pregnancy_check
           (id, tenant_id, dam_id, service_id, check_date, method, result, gestation_days_estimate, expected_calving_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, tenant_id, dam_id, service_id, check_date, method, result,
                   gestation_days_estimate, expected_calving_date::text AS expected_calving_date`,
        [
          id,
          context.tenantId,
          input.damId,
          input.serviceId ?? null,
          input.checkDate,
          input.method ?? null,
          input.result,
          input.gestationDaysEstimate ?? null,
          expectedCalvingDate,
        ],
      );
      const append = await appendEvent(
        client,
        createEventEnvelope({
          eventType: PREGNANCY_CHECKED,
          context,
          aggregateType: "animal",
          aggregateId: input.damId,
          aggregateVersion: await this.nextAnimalVersion(client, context.tenantId, input.damId),
          occurredAt: new Date(input.checkDate),
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `pregcheck-${id}`,
          payload: {
            pregnancyCheckId: id,
            damId: input.damId,
            result: input.result,
            expectedCalvingDate,
          },
        }),
        { environment: this.environment },
      );
      await client.query(`UPDATE pregnancy_check SET event_id = $2 WHERE id = $1`, [id, append.eventId]);
      const r = inserted.rows[0]!;
      return {
        id: r.id,
        tenantId: r.tenant_id,
        damId: r.dam_id,
        serviceId: r.service_id,
        checkDate: r.check_date,
        method: r.method,
        result: r.result,
        gestationDaysEstimate: r.gestation_days_estimate,
        expectedCalvingDate: r.expected_calving_date,
      } satisfies PregnancyCheck;
    });
  }

  /** Calving workflow (JK-REP-006): create/link calf, record parentage. */
  async recordCalving(context: TenantContext, rawInput: RecordCalvingInput): Promise<Calving> {
    const input = parseInput(recordCalvingInputSchema, rawInput, "recordCalving input");
    return this.authorized(context, "record_reproduction", async (client) => {
      await this.assertFemale(client, input.damId);
      if (input.calf && input.outcome !== "live") {
        throw new ValidationError("A calf can only be registered when the calving outcome is 'live'");
      }

      // Determine the sire from the linked/latest service, for parentage.
      const sire = await this.sireFor(client, input.damId, input.serviceId);

      let calfId: Uuid | null = null;
      if (input.calf && input.outcome === "live") {
        calfId = await this.calfRegistrar.registerCalf(
          client,
          context,
          {
            farmId: input.calf.farmId,
            visualId: input.calf.visualId,
            sex: input.calf.sex,
            rfid: input.calf.rfid,
            birthDate: input.calvingDate.slice(0, 10),
            damId: input.damId,
            sireId: sire.bullId,
            sireExternalRef: sire.externalRef,
          },
          { environment: this.environment },
        );
        // Parentage edges (JK-GEN-001): dam (known) + sire (from service).
        await client.query(
          `INSERT INTO animal_parentage (tenant_id, child_id, parent_id, relation, confidence)
           VALUES ($1,$2,$3,'dam','known')`,
          [context.tenantId, calfId, input.damId],
        );
        if (sire.bullId || sire.externalRef) {
          await client.query(
            `INSERT INTO animal_parentage (tenant_id, child_id, parent_id, external_parent_ref, relation, confidence)
             VALUES ($1,$2,$3,$4,'sire',$5)`,
            [context.tenantId, calfId, sire.bullId, sire.externalRef, input.sireConfidence ?? "probable"],
          );
        }
      }

      const id = newUuid();
      const inserted = await client.query(
        `INSERT INTO calving
           (id, tenant_id, dam_id, service_id, calving_date, ease, outcome, calf_id, birth_weight_kg, sire_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, tenant_id, dam_id, service_id, calving_date, ease, outcome, calf_id, birth_weight_kg, sire_confidence`,
        [
          id,
          context.tenantId,
          input.damId,
          input.serviceId ?? null,
          input.calvingDate,
          input.ease ?? null,
          input.outcome,
          calfId,
          input.birthWeightKg ?? null,
          input.sireConfidence ?? null,
        ],
      );
      const append = await appendEvent(
        client,
        createEventEnvelope({
          eventType: CALVING_RECORDED,
          context,
          aggregateType: "animal",
          aggregateId: input.damId,
          aggregateVersion: await this.nextAnimalVersion(client, context.tenantId, input.damId),
          occurredAt: new Date(input.calvingDate),
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `calving-${id}`,
          payload: {
            calvingId: id,
            damId: input.damId,
            outcome: input.outcome,
            calfId,
            birthWeightKg: input.birthWeightKg ?? null,
          },
        }),
        { environment: this.environment },
      );
      await client.query(`UPDATE calving SET event_id = $2 WHERE id = $1`, [id, append.eventId]);
      const r = inserted.rows[0]!;
      return {
        id: r.id,
        tenantId: r.tenant_id,
        damId: r.dam_id,
        serviceId: r.service_id,
        calvingDate: r.calving_date,
        ease: r.ease,
        outcome: r.outcome,
        calfId: r.calf_id,
        birthWeightKg: r.birth_weight_kg === null ? null : Number(r.birth_weight_kg),
        sireConfidence: r.sire_confidence,
      } satisfies Calving;
    });
  }

  /** Current reproduction state projected from the recorded facts (§12.1). */
  async getReproductionStatus(context: TenantContext, damId: Uuid): Promise<ReproductionStatus> {
    return this.authorized(context, "read", async (client) => {
      const lastService = await client.query<{ service_date: Date }>(
        `SELECT service_date FROM reproduction_service WHERE dam_id = $1 ORDER BY service_date DESC LIMIT 1`,
        [damId],
      );
      const lastCheck = await client.query<{ result: string; check_date: Date; expected_calving_date: string | null }>(
        `SELECT result, check_date, expected_calving_date::text AS expected_calving_date FROM pregnancy_check
         WHERE dam_id = $1 ORDER BY check_date DESC LIMIT 1`,
        [damId],
      );
      const lastCalving = await client.query<{ calving_date: Date }>(
        `SELECT calving_date FROM calving WHERE dam_id = $1 ORDER BY calving_date DESC LIMIT 1`,
        [damId],
      );

      const serviceDate = lastService.rows[0]?.service_date ?? null;
      const check = lastCheck.rows[0];
      const calvingDate = lastCalving.rows[0]?.calving_date ?? null;

      let state: ReproductionState = "open";
      let lastEventAt: Date | null = serviceDate;
      let expectedCalvingDate: string | null = null;

      if (serviceDate) {
        state = "served";
      }
      if (check) {
        lastEventAt = check.check_date;
        if (check.result === "positive") {
          state = "pregnant";
          expectedCalvingDate = check.expected_calving_date;
        } else if (check.result === "loss") {
          state = "loss";
        } else if (check.result === "negative") {
          state = "open";
        } else {
          state = "awaiting_check";
        }
      }
      if (calvingDate && (!check || calvingDate > check.check_date)) {
        state = "calved";
        lastEventAt = calvingDate;
        expectedCalvingDate = null;
      }

      return { damId, state, lastServiceDate: serviceDate, expectedCalvingDate, lastEventAt };
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async assertFemale(client: pg.PoolClient, damId: Uuid): Promise<void> {
    const result = await client.query<{ sex: string }>(`SELECT sex FROM animal WHERE id = $1`, [damId]);
    if (result.rows.length === 0) throw new NotFoundError(`Animal ${damId} not found`);
    if (result.rows[0]!.sex !== "female") {
      throw new ValidationError(`Animal ${damId} is not female; reproduction events require a dam`);
    }
  }

  private async serviceDateFor(
    client: pg.PoolClient,
    damId: Uuid,
    serviceId?: string,
  ): Promise<Date | null> {
    if (serviceId) {
      const s = await client.query<{ service_date: Date }>(
        `SELECT service_date FROM reproduction_service WHERE id = $1`,
        [serviceId],
      );
      return s.rows[0]?.service_date ?? null;
    }
    const latest = await client.query<{ service_date: Date }>(
      `SELECT service_date FROM reproduction_service WHERE dam_id = $1 ORDER BY service_date DESC LIMIT 1`,
      [damId],
    );
    return latest.rows[0]?.service_date ?? null;
  }

  private async sireFor(
    client: pg.PoolClient,
    damId: Uuid,
    serviceId?: string,
  ): Promise<{ bullId: Uuid | null; externalRef: string | null }> {
    const query = serviceId
      ? await client.query<{ bull_id: string | null; external_sire_ref: string | null }>(
          `SELECT bull_id, external_sire_ref FROM reproduction_service WHERE id = $1`,
          [serviceId],
        )
      : await client.query<{ bull_id: string | null; external_sire_ref: string | null }>(
          `SELECT bull_id, external_sire_ref FROM reproduction_service
           WHERE dam_id = $1 ORDER BY service_date DESC LIMIT 1`,
          [damId],
        );
    return {
      bullId: query.rows[0]?.bull_id ?? null,
      externalRef: query.rows[0]?.external_sire_ref ?? null,
    };
  }

  private async nextAnimalVersion(client: pg.PoolClient, tenantId: string, animalId: string): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event WHERE tenant_id = $1 AND aggregate_type = 'animal' AND aggregate_id = $2`,
      [tenantId, animalId],
    );
    return result.rows[0]!.next;
  }

  private async authorized<T>(
    context: TenantContext,
    action: ReproAction,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide(action, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new ReproForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}
