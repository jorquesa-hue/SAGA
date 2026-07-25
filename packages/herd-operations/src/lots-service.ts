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
import { decide, loadCallerMemberships, type HerdAction } from "./authorization.js";
import { HerdForbiddenError } from "./errors.js";
import {
  LOT_CREATED,
  LOT_MEMBERSHIP_ENDED,
  LOT_MEMBERSHIP_STARTED,
  LOT_MOVED,
} from "./events.js";

/**
 * Lots and movements in the Herd Operations context (JK-HER-001..005, §10, §20).
 * Lot membership and paddock location are temporal; current state is a
 * projection of movement facts. An animal has at most one active operational
 * lot; moving into a lot closes the prior membership. Moving a lot to a paddock
 * closes the prior occupation before opening the next.
 */

export type LotPurpose = "genetic_nucleus" | "beef" | "rearing" | "quarantine" | "other";

export interface Lot {
  id: Uuid;
  tenantId: Uuid;
  farmId: Uuid;
  name: string;
  purpose: LotPurpose;
  target: string | null;
  status: "open" | "closed";
}

/** A lot as an operator reads it: the record plus its two live projections. */
export interface LotSummary extends Omit<Lot, "tenantId"> {
  farmName: string;
  startedAt: string;
  endedAt: string | null;
  headCount: number;
  currentPaddockId: Uuid | null;
  currentPaddockName: string | null;
  inPaddockSince: string | null;
}

const idempotencyKeySchema = z.string().min(1).max(200);

export const createLotInputSchema = z
  .object({
    farmId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    purpose: z
      .enum(["genetic_nucleus", "beef", "rearing", "quarantine", "other"])
      .default("beef"),
    target: z.string().max(200).optional(),
    responsibleId: z.string().uuid().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();
export type CreateLotInput = z.input<typeof createLotInputSchema>;

export const lotMembershipInputSchema = z
  .object({
    lotId: z.string().uuid(),
    animalIds: z.array(z.string().uuid()).min(1).max(2000),
    effectiveAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type LotMembershipInput = z.input<typeof lotMembershipInputSchema>;

export const moveToPaddockInputSchema = z
  .object({
    lotId: z.string().uuid(),
    paddockId: z.string().uuid(),
    movedAt: z.string().datetime({ offset: true }).optional(),
    headCount: z.number().int().nonnegative().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();
export type MoveToPaddockInput = z.input<typeof moveToPaddockInputSchema>;

export interface MembershipChangeResult {
  animalId: Uuid;
  status: "added" | "removed" | "error";
  reason?: string;
}

export interface LotsServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

function parse<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  what: string,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      `Invalid ${what}`,
      result.error.issues.map((i) => ({ field: i.path.join("."), reason: i.message })),
    );
  }
  return result.data;
}

export class LotsService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: LotsServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  async createLot(context: TenantContext, rawInput: CreateLotInput): Promise<Lot> {
    const input = parse(createLotInputSchema, rawInput, "createLot input");
    return this.authorized(context, "manage_lots", async (client) => {
      const farm = await client.query(`SELECT 1 FROM farm WHERE id = $1`, [input.farmId]);
      if (farm.rows.length === 0)
        throw new NotFoundError(`Farm ${input.farmId} not found`);
      let row;
      try {
        const inserted = await client.query(
          `INSERT INTO lot (tenant_id, farm_id, name, purpose, target, responsible_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, tenant_id, farm_id, name, purpose, target, status`,
          [
            context.tenantId,
            input.farmId,
            input.name,
            input.purpose,
            input.target ?? null,
            input.responsibleId ?? null,
          ],
        );
        row = inserted.rows[0]!;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ValidationError(
            `An open lot named '${input.name}' already exists on this farm`,
          );
        }
        throw error;
      }
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: LOT_CREATED,
          context,
          farmId: input.farmId,
          aggregateType: "lot",
          aggregateId: row.id,
          aggregateVersion: 1,
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `lot-create-${row.id}`,
          payload: {
            lotId: row.id,
            farmId: input.farmId,
            name: input.name,
            purpose: input.purpose,
          },
        }),
        { environment: this.environment },
      );
      return {
        id: row.id,
        tenantId: row.tenant_id,
        farmId: row.farm_id,
        name: row.name,
        purpose: row.purpose,
        target: row.target,
        status: row.status,
      } satisfies Lot;
    });
  }

  /**
   * Add animals to a lot. If an animal is already in another active operational
   * lot, that membership is closed first (a move), then the new one opens
   * (JK-HER-002 conflicting-membership validation).
   */
  async addAnimals(
    context: TenantContext,
    rawInput: LotMembershipInput,
  ): Promise<MembershipChangeResult[]> {
    const input = parse(lotMembershipInputSchema, rawInput, "addAnimals input");
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
    return this.authorized(context, "manage_lots", async (client) => {
      await this.assertLotOpen(client, input.lotId);
      const results: MembershipChangeResult[] = [];
      for (const animalId of input.animalIds) {
        await client.query("SAVEPOINT lot_item");
        try {
          const animal = await client.query(`SELECT 1 FROM animal WHERE id = $1`, [
            animalId,
          ]);
          if (animal.rows.length === 0)
            throw new NotFoundError(`Animal ${animalId} not found`);

          // Close any existing active membership (move semantics).
          const prior = await client.query<{ id: string; lot_id: string }>(
            `UPDATE lot_membership SET valid_to = $2
             WHERE animal_id = $1 AND valid_to IS NULL
             RETURNING id, lot_id`,
            [animalId, effectiveAt.toISOString()],
          );
          for (const p of prior.rows) {
            if (p.lot_id !== input.lotId) {
              await this.appendAnimalEvent(
                client,
                context,
                animalId,
                LOT_MEMBERSHIP_ENDED,
                {
                  animalId,
                  lotId: p.lot_id,
                  reason: "moved_to_other_lot",
                },
              );
            }
          }
          // If it was already in this lot, we've just closed it; reopen fresh.
          await client.query(
            `INSERT INTO lot_membership (tenant_id, lot_id, animal_id, valid_from)
             VALUES ($1,$2,$3,$4)`,
            [context.tenantId, input.lotId, animalId, effectiveAt.toISOString()],
          );
          await this.appendAnimalEvent(
            client,
            context,
            animalId,
            LOT_MEMBERSHIP_STARTED,
            {
              animalId,
              lotId: input.lotId,
            },
          );
          await client.query("RELEASE SAVEPOINT lot_item");
          results.push({ animalId, status: "added" });
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT lot_item");
          results.push({ animalId, status: "error", reason: (error as Error).message });
        }
      }
      return results;
    });
  }

  async removeAnimals(
    context: TenantContext,
    rawInput: LotMembershipInput,
  ): Promise<MembershipChangeResult[]> {
    const input = parse(lotMembershipInputSchema, rawInput, "removeAnimals input");
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
    return this.authorized(context, "manage_lots", async (client) => {
      const results: MembershipChangeResult[] = [];
      for (const animalId of input.animalIds) {
        const closed = await client.query(
          `UPDATE lot_membership SET valid_to = $3
           WHERE lot_id = $1 AND animal_id = $2 AND valid_to IS NULL
           RETURNING id`,
          [input.lotId, animalId, effectiveAt.toISOString()],
        );
        if (closed.rows.length === 0) {
          results.push({
            animalId,
            status: "error",
            reason: "not an active member of this lot",
          });
          continue;
        }
        await this.appendAnimalEvent(client, context, animalId, LOT_MEMBERSHIP_ENDED, {
          animalId,
          lotId: input.lotId,
          reason: "removed",
        });
        results.push({ animalId, status: "removed" });
      }
      return results;
    });
  }

  /** Batch-move a lot between paddocks; closes the prior occupation (JK-HER-003). */
  async moveToPaddock(
    context: TenantContext,
    rawInput: MoveToPaddockInput,
  ): Promise<{ occupationId: Uuid }> {
    const input = parse(moveToPaddockInputSchema, rawInput, "moveToPaddock input");
    const movedAt = input.movedAt ? new Date(input.movedAt) : new Date();
    return this.authorized(context, "manage_lots", async (client) => {
      await this.assertLotOpen(client, input.lotId);
      const paddock = await client.query(`SELECT 1 FROM paddock WHERE id = $1`, [
        input.paddockId,
      ]);
      if (paddock.rows.length === 0)
        throw new NotFoundError(`Paddock ${input.paddockId} not found`);

      // Close the previous open occupation before opening the next.
      const prior = await client.query<{ paddock_id: string }>(
        `UPDATE paddock_occupation SET exit_at = $2
         WHERE lot_id = $1 AND exit_at IS NULL
         RETURNING paddock_id`,
        [input.lotId, movedAt.toISOString()],
      );
      const fromPaddock = prior.rows[0]?.paddock_id ?? null;

      const occupationId = newUuid();
      await client.query(
        `INSERT INTO paddock_occupation (id, tenant_id, paddock_id, lot_id, entry_at, head_count)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          occupationId,
          context.tenantId,
          input.paddockId,
          input.lotId,
          movedAt.toISOString(),
          input.headCount ?? null,
        ],
      );
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: LOT_MOVED,
          context,
          aggregateType: "lot",
          aggregateId: input.lotId,
          aggregateVersion: await this.nextVersion(
            client,
            context.tenantId,
            "lot",
            input.lotId,
          ),
          occurredAt: movedAt,
          source: { channel: "api" },
          idempotencyKey: input.idempotencyKey ?? `lot-move-${occupationId}`,
          payload: {
            lotId: input.lotId,
            fromPaddockId: fromPaddock,
            toPaddockId: input.paddockId,
            headCount: input.headCount ?? null,
          },
        }),
        { environment: this.environment },
      );
      return { occupationId };
    });
  }

  /**
   * Every lot in the tenant with the two numbers a manager actually asks for:
   * how many head are in it and which paddock it is standing in (JK-HER-004).
   * Both are projections of movement facts, computed here rather than stored.
   */
  async listLots(context: TenantContext): Promise<LotSummary[]> {
    return this.authorized(context, "read", async (client) => {
      const result = await client.query<{
        id: string;
        farm_id: string;
        farm_name: string;
        name: string;
        purpose: LotPurpose;
        target: string | null;
        status: "open" | "closed";
        started_at: Date;
        ended_at: Date | null;
        head_count: string;
        paddock_id: string | null;
        paddock_name: string | null;
        entry_at: Date | null;
      }>(
        `SELECT l.id, l.farm_id, f.name AS farm_name, l.name, l.purpose, l.target,
                l.status, l.started_at, l.ended_at,
                (SELECT count(*) FROM lot_membership m
                  WHERE m.lot_id = l.id AND m.valid_to IS NULL) AS head_count,
                o.paddock_id, p.name AS paddock_name, o.entry_at
           FROM lot l
           JOIN farm f ON f.id = l.farm_id
           LEFT JOIN paddock_occupation o ON o.lot_id = l.id AND o.exit_at IS NULL
           LEFT JOIN paddock p ON p.id = o.paddock_id
          ORDER BY l.status, l.name`,
      );
      return result.rows.map((r) => ({
        id: r.id,
        farmId: r.farm_id,
        farmName: r.farm_name,
        name: r.name,
        purpose: r.purpose,
        target: r.target,
        status: r.status,
        startedAt: r.started_at.toISOString(),
        endedAt: r.ended_at?.toISOString() ?? null,
        headCount: Number(r.head_count),
        currentPaddockId: r.paddock_id,
        currentPaddockName: r.paddock_name,
        inPaddockSince: r.entry_at?.toISOString() ?? null,
      }));
    });
  }

  /** Current active members of a lot (projection, JK-HER-004). */
  async getLotMembers(context: TenantContext, lotId: Uuid): Promise<Uuid[]> {
    return this.authorized(context, "read", async (client) => {
      const result = await client.query<{ animal_id: string }>(
        `SELECT animal_id FROM lot_membership WHERE lot_id = $1 AND valid_to IS NULL ORDER BY animal_id`,
        [lotId],
      );
      return result.rows.map((r) => r.animal_id);
    });
  }

  /** An animal's current operational lot, or null (projection, JK-HER-004). */
  async getAnimalLot(context: TenantContext, animalId: Uuid): Promise<Uuid | null> {
    return this.authorized(context, "read", async (client) => {
      const result = await client.query<{ lot_id: string }>(
        `SELECT lot_id FROM lot_membership WHERE animal_id = $1 AND valid_to IS NULL`,
        [animalId],
      );
      return result.rows[0]?.lot_id ?? null;
    });
  }

  /** A lot's current paddock, or null (projection, JK-HER-004). */
  async getCurrentPaddock(context: TenantContext, lotId: Uuid): Promise<Uuid | null> {
    return this.authorized(context, "read", async (client) => {
      const result = await client.query<{ paddock_id: string }>(
        `SELECT paddock_id FROM paddock_occupation WHERE lot_id = $1 AND exit_at IS NULL`,
        [lotId],
      );
      return result.rows[0]?.paddock_id ?? null;
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async assertLotOpen(client: pg.PoolClient, lotId: Uuid): Promise<void> {
    const result = await client.query<{ status: string }>(
      `SELECT status FROM lot WHERE id = $1`,
      [lotId],
    );
    if (result.rows.length === 0) throw new NotFoundError(`Lot ${lotId} not found`);
    if (result.rows[0]!.status !== "open")
      throw new ValidationError(`Lot ${lotId} is closed`);
  }

  private async appendAnimalEvent(
    client: pg.PoolClient,
    context: TenantContext,
    animalId: Uuid,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await appendEvent(
      client,
      createEventEnvelope({
        eventType,
        context,
        aggregateType: "animal",
        aggregateId: animalId,
        aggregateVersion: await this.nextVersion(
          client,
          context.tenantId,
          "animal",
          animalId,
        ),
        source: { channel: "api" },
        idempotencyKey: `${eventType}-${animalId}-${newUuid()}`,
        payload,
      }),
      { environment: this.environment },
    );
  }

  private async nextVersion(
    client: pg.PoolClient,
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
  ): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event WHERE tenant_id = $1 AND aggregate_type = $2 AND aggregate_id = $3`,
      [tenantId, aggregateType, aggregateId],
    );
    return result.rows[0]!.next;
  }

  private async authorized<T>(
    context: TenantContext,
    action: HerdAction,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide(action, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok)
      throw new HerdForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}
