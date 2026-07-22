import {
  ConflictError,
  createEventEnvelope,
  NotFoundError,
  newUuid,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import { appendEvent, withTenantTransaction } from "@jk/database";
import type pg from "pg";
import {
  decide,
  loadCallerMemberships,
  type AnimalAction,
} from "./authorization.js";
import {
  assignIdentifierInputSchema,
  mapAnimalRow,
  mapIdentifierRow,
  parseInput,
  registerAnimalInputSchema,
  replaceIdentifierInputSchema,
  type Animal,
  type AnimalIdentifier,
  type AnimalRow,
  type AssignIdentifierInput,
  type IdentifierRow,
  type RegisterAnimalInput,
  type ReplaceIdentifierInput,
  type TimelineEntry,
} from "./domain.js";
import { AnimalForbiddenError } from "./errors.js";
import { ANIMAL_REGISTERED, IDENTIFIER_ASSIGNED, IDENTIFIER_REPLACED } from "./events.js";

export interface AnimalRegistryOptions {
  /** RLS-enforced application role credentials (jk_app). */
  appPool: pg.Pool;
  environment?: string;
}

/**
 * Animal Registry application service (§18, JK-ANI-001..008). Every write
 * runs in one tenant transaction that: loads the caller's memberships, decides
 * authorization (auditing denials), mutates state, appends the canonical
 * domain event through the transactional outbox, and writes a success audit.
 * Animal identity (internal UUID) is created once and never changes.
 */
export class AnimalRegistryService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: AnimalRegistryOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  async registerAnimal(context: TenantContext, rawInput: RegisterAnimalInput): Promise<Animal> {
    const input = parseInput(registerAnimalInputSchema, rawInput, "registerAnimal input");
    const animalId = newUuid();
    return this.authorized(context, "register_animal", { type: "animal", id: animalId }, async (client) => {
      // The farm must exist in this tenant (composite FK also enforces it).
      const farm = await client.query(`SELECT 1 FROM farm WHERE id = $1`, [input.farmId]);
      if (farm.rows.length === 0) {
        throw new NotFoundError(`Farm ${input.farmId} not found`);
      }

      let animalRow: AnimalRow;
      try {
        const inserted = await client.query<AnimalRow>(
          `INSERT INTO animal
             (id, tenant_id, farm_id, visual_id, species_code, breed_code, sex,
              birth_date, birth_date_precision, lifecycle_status, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',1)
           RETURNING id, tenant_id, farm_id, visual_id, species_code, breed_code, sex,
                     birth_date, birth_date_precision, lifecycle_status, version, created_at`,
          [
            animalId,
            context.tenantId,
            input.farmId,
            input.visualId,
            input.speciesCode,
            input.breedCode,
            input.sex,
            input.birthDate ?? null,
            input.birthDatePrecision,
          ],
        );
        animalRow = inserted.rows[0]!;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `An animal with visual id '${input.visualId}' already exists in this tenant`,
          );
        }
        throw error;
      }

      // Visual identifier row (the management id as a tracked identifier).
      await this.insertIdentifier(client, context, animalId, "visual", input.visualId);

      // Optional initial RFID (JK-DOM-003 uniqueness enforced by the index).
      if (input.rfid) {
        await this.insertIdentifier(client, context, animalId, "rfid", input.rfid);
      }

      await appendEvent(
        client,
        createEventEnvelope({
          eventType: ANIMAL_REGISTERED,
          context,
          farmId: input.farmId,
          aggregateType: "animal",
          aggregateId: animalId,
          aggregateVersion: 1,
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `animal-register-${animalId}`,
          payload: {
            animalId,
            farmId: input.farmId,
            visualId: input.visualId,
            speciesCode: input.speciesCode,
            breedCode: input.breedCode,
            sex: input.sex,
            birthDate: input.birthDate ?? null,
            birthDatePrecision: input.birthDatePrecision,
            rfid: input.rfid ?? null,
          },
        }),
        { environment: this.environment },
      );

      await this.audit(client, context, "animal.registered", "animal", animalId, "success", {
        visualId: input.visualId,
      });

      return mapAnimalRow(animalRow);
    });
  }

  async assignIdentifier(
    context: TenantContext,
    rawInput: AssignIdentifierInput,
  ): Promise<AnimalIdentifier> {
    const input = parseInput(assignIdentifierInputSchema, rawInput, "assignIdentifier input");
    return this.authorized(context, "manage_identifiers", { type: "animal", id: input.animalId }, async (client) => {
      await this.assertAnimalExists(client, input.animalId);
      const identifier = await this.insertIdentifier(
        client,
        context,
        input.animalId,
        input.identifierType,
        input.identifierValue,
      );
      const version = await this.nextAggregateVersion(client, context.tenantId, input.animalId);
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: IDENTIFIER_ASSIGNED,
          context,
          aggregateType: "animal",
          aggregateId: input.animalId,
          aggregateVersion: version,
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `identifier-assign-${identifier.id}`,
          payload: {
            animalId: input.animalId,
            identifierType: input.identifierType,
            identifierValue: input.identifierValue,
          },
        }),
        { environment: this.environment },
      );
      await this.bumpAnimalVersion(client, input.animalId);
      await this.audit(client, context, "animal.identifier_assigned", "animal", input.animalId, "success", {
        identifierType: input.identifierType,
      });
      return identifier;
    });
  }

  /**
   * Replace the active identifier of a type: close the current interval and
   * open a new one, preserving history (JK-ANI-008, §40 relationship closure).
   * Identity is unaffected (JK-DOM-002).
   */
  async replaceIdentifier(
    context: TenantContext,
    rawInput: ReplaceIdentifierInput,
  ): Promise<AnimalIdentifier> {
    const input = parseInput(replaceIdentifierInputSchema, rawInput, "replaceIdentifier input");
    return this.authorized(context, "manage_identifiers", { type: "animal", id: input.animalId }, async (client) => {
      await this.assertAnimalExists(client, input.animalId);
      const current = await client.query<IdentifierRow>(
        `SELECT * FROM animal_identifier
         WHERE animal_id = $1 AND identifier_type = $2 AND valid_to IS NULL`,
        [input.animalId, input.identifierType],
      );
      const previousValue = current.rows[0]?.identifier_value ?? null;
      // Close the current active assignment (if any).
      await client.query(
        `UPDATE animal_identifier SET valid_to = now()
         WHERE animal_id = $1 AND identifier_type = $2 AND valid_to IS NULL`,
        [input.animalId, input.identifierType],
      );
      // Open the new assignment.
      const identifier = await this.insertIdentifier(
        client,
        context,
        input.animalId,
        input.identifierType,
        input.newValue,
      );
      const version = await this.nextAggregateVersion(client, context.tenantId, input.animalId);
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: IDENTIFIER_REPLACED,
          context,
          aggregateType: "animal",
          aggregateId: input.animalId,
          aggregateVersion: version,
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `identifier-replace-${identifier.id}`,
          payload: {
            animalId: input.animalId,
            identifierType: input.identifierType,
            previousValue,
            newValue: input.newValue,
            reason: input.reason ?? null,
          },
        }),
        { environment: this.environment },
      );
      await this.bumpAnimalVersion(client, input.animalId);
      await this.audit(client, context, "animal.identifier_replaced", "animal", input.animalId, "success", {
        identifierType: input.identifierType,
        previousValue,
        newValue: input.newValue,
      });
      return identifier;
    });
  }

  // -------------------------------------------------------------------------
  // Queries (read: any active membership)
  // -------------------------------------------------------------------------

  async getAnimal(context: TenantContext, animalId: Uuid): Promise<Animal> {
    return this.authorized(context, "read", { type: "animal", id: animalId }, async (client) => {
      const result = await client.query<AnimalRow>(
        `SELECT id, tenant_id, farm_id, visual_id, species_code, breed_code, sex,
                birth_date, birth_date_precision, lifecycle_status, version, created_at
         FROM animal WHERE id = $1`,
        [animalId],
      );
      if (result.rows.length === 0) throw new NotFoundError(`Animal ${animalId} not found`);
      return mapAnimalRow(result.rows[0]!);
    });
  }

  async resolveRfid(context: TenantContext, rfid: string): Promise<Animal | null> {
    return this.authorized(context, "read", { type: "animal" }, async (client) => {
      const result = await client.query<AnimalRow>(
        `SELECT a.id, a.tenant_id, a.farm_id, a.visual_id, a.species_code, a.breed_code, a.sex,
                a.birth_date, a.birth_date_precision, a.lifecycle_status, a.version, a.created_at
         FROM animal_identifier i
         JOIN animal a ON a.id = i.animal_id
         WHERE i.identifier_type = 'rfid' AND i.identifier_value = $1 AND i.valid_to IS NULL`,
        [rfid],
      );
      return result.rows.length > 0 ? mapAnimalRow(result.rows[0]!) : null;
    });
  }

  async listAnimals(context: TenantContext, farmId?: Uuid): Promise<Animal[]> {
    return this.authorized(context, "read", { type: "animal" }, async (client) => {
      const result = farmId
        ? await client.query<AnimalRow>(
            `SELECT id, tenant_id, farm_id, visual_id, species_code, breed_code, sex,
                    birth_date, birth_date_precision, lifecycle_status, version, created_at
             FROM animal WHERE farm_id = $1 ORDER BY visual_id`,
            [farmId],
          )
        : await client.query<AnimalRow>(
            `SELECT id, tenant_id, farm_id, visual_id, species_code, breed_code, sex,
                    birth_date, birth_date_precision, lifecycle_status, version, created_at
             FROM animal ORDER BY visual_id`,
          );
      return result.rows.map(mapAnimalRow);
    });
  }

  /** Chronological, filterable event timeline for an animal (JK-ANI-004). */
  async getTimeline(
    context: TenantContext,
    animalId: Uuid,
    options: { limit?: number; types?: string[] } = {},
  ): Promise<TimelineEntry[]> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    return this.authorized(context, "read", { type: "animal", id: animalId }, async (client) => {
      await this.assertAnimalExists(client, animalId);
      const params: unknown[] = [animalId];
      let typeFilter = "";
      if (options.types && options.types.length > 0) {
        params.push(options.types);
        typeFilter = `AND event_type = ANY($${params.length})`;
      }
      params.push(limit);
      const result = await client.query(
        `SELECT event_id, event_type, occurred_at, recorded_at, actor_type, actor_id, payload, metadata
         FROM domain_event
         WHERE aggregate_type = 'animal' AND aggregate_id = $1 ${typeFilter}
         ORDER BY occurred_at DESC, event_id DESC
         LIMIT $${params.length}`,
        params,
      );
      return result.rows.map((row) => ({
        eventId: row.event_id,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
        recordedAt: row.recorded_at,
        actorType: row.actor_type,
        actorId: row.actor_id,
        payload: row.payload,
        metadata: row.metadata,
      }));
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async insertIdentifier(
    client: pg.PoolClient,
    context: TenantContext,
    animalId: Uuid,
    identifierType: string,
    identifierValue: string,
  ): Promise<AnimalIdentifier> {
    try {
      const inserted = await client.query<IdentifierRow>(
        `INSERT INTO animal_identifier
           (id, tenant_id, animal_id, identifier_type, identifier_value, valid_from, assigned_by)
         VALUES ($1,$2,$3,$4,$5, now(), $6)
         RETURNING *`,
        [
          newUuid(),
          context.tenantId,
          animalId,
          identifierType,
          identifierValue,
          context.actor.type === "user" ? context.actor.id : null,
        ],
      );
      return mapIdentifierRow(inserted.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          `${identifierType} '${identifierValue}' is already active on another animal`,
          "JK-ANI-RFID-CONFLICT",
        );
      }
      throw error;
    }
  }

  private async assertAnimalExists(client: pg.PoolClient, animalId: Uuid): Promise<void> {
    const result = await client.query(`SELECT 1 FROM animal WHERE id = $1`, [animalId]);
    if (result.rows.length === 0) throw new NotFoundError(`Animal ${animalId} not found`);
  }

  private async bumpAnimalVersion(client: pg.PoolClient, animalId: Uuid): Promise<void> {
    await client.query(`UPDATE animal SET version = version + 1 WHERE id = $1`, [animalId]);
  }

  private async nextAggregateVersion(
    client: pg.PoolClient,
    tenantId: Uuid,
    animalId: Uuid,
  ): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event
       WHERE tenant_id = $1 AND aggregate_type = 'animal' AND aggregate_id = $2`,
      [tenantId, animalId],
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
    action: AnimalAction,
    resource: { type: string; id?: string },
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide(action, memberships);
      if (!decision.allowed) {
        await this.audit(client, context, `animal.${action}`, resource.type, resource.id ?? null, "denied", {
          reason: decision.reason,
        });
        return { ok: false as const, reason: decision.reason, decision };
      }
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) {
      throw new AnimalForbiddenError(outcome.reason, outcome.decision);
    }
    return outcome.value;
  }
}
