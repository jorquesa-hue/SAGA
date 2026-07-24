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
import { loadCallerMemberships } from "./authorization.js";
import { ReproForbiddenError } from "./errors.js";

/**
 * Genetics service (JK-GEN-002/004/005/006, §12.3, §22): import DEP/EBV
 * evaluations with full provenance, define versioned selection indexes, rank
 * animals with every input/normalization/percentile/exclusion exposed, and
 * track genetic progress across birth cohorts.
 */

export const EVALUATION_IMPORTED = "genetics.evaluation_imported.v1";
const GENETICS_WRITE_ROLES = new Set(["tenant_owner", "genetics_specialist"]);

export const importEvaluationInputSchema = z
  .object({
    animalId: z.string().uuid(),
    provider: z.string().min(1).max(120),
    evaluationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    trait: z.string().min(1).max(60),
    value: z.number().finite(),
    percentile: z.number().min(0).max(100).optional(),
    reliability: z.number().min(0).max(1).optional(),
    sourceFile: z.string().max(300).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type ImportEvaluationInput = z.input<typeof importEvaluationInputSchema>;

export const defineIndexInputSchema = z
  .object({
    name: z.string().min(1).max(120),
    version: z.number().int().positive().default(1),
    weights: z.record(z.number()),
    missingDataBehavior: z.enum(["exclude", "treat_as_zero"]).default("exclude"),
  })
  .strict();
export type DefineIndexInput = z.input<typeof defineIndexInputSchema>;

export interface RankedAnimal {
  animalId: Uuid;
  score: number | null;
  excluded: boolean;
  exclusionReason?: string;
  breakdown: Array<{
    trait: string;
    rawValue: number | null;
    normalized: number | null;
    weight: number;
    contribution: number;
    percentile: number | null;
  }>;
}

export interface GeneticsServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

export class GeneticsService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: GeneticsServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  /** Import a provider DEP/EBV value, retaining provenance (JK-GEN-002). */
  async importEvaluation(
    context: TenantContext,
    rawInput: ImportEvaluationInput,
  ): Promise<{ evaluationId: Uuid }> {
    const input = this.parse(importEvaluationInputSchema, rawInput);
    return this.authorized(context, true, async (client) => {
      const animal = await client.query(`SELECT 1 FROM animal WHERE id = $1`, [
        input.animalId,
      ]);
      if (animal.rows.length === 0)
        throw new NotFoundError(`Animal ${input.animalId} not found`);
      const id = newUuid();
      let eventId: string;
      try {
        const env = createEventEnvelope({
          eventType: EVALUATION_IMPORTED,
          context,
          aggregateType: "animal",
          aggregateId: input.animalId,
          aggregateVersion: await this.nextVersion(
            client,
            context.tenantId,
            input.animalId,
          ),
          source: { channel: "import" },
          idempotencyKey: input.idempotencyKey ?? `eval-${id}`,
          payload: {
            evaluationId: id,
            animalId: input.animalId,
            provider: input.provider,
            trait: input.trait,
            value: input.value,
          },
        });
        eventId = (await appendEvent(client, env, { environment: this.environment }))
          .eventId;
        await client.query(
          `INSERT INTO genetic_evaluation
             (id, tenant_id, animal_id, provider, evaluation_date, trait, value, percentile, reliability, source_file, event_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            context.tenantId,
            input.animalId,
            input.provider,
            input.evaluationDate,
            input.trait,
            input.value,
            input.percentile ?? null,
            input.reliability ?? null,
            input.sourceFile ?? null,
            eventId,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ValidationError(
            "This evaluation (animal/provider/date/trait) was already imported",
          );
        }
        throw error;
      }
      return { evaluationId: id };
    });
  }

  async defineSelectionIndex(
    context: TenantContext,
    rawInput: DefineIndexInput,
  ): Promise<{ indexId: Uuid }> {
    const input = this.parse(defineIndexInputSchema, rawInput);
    if (Object.keys(input.weights).length === 0) {
      throw new ValidationError("A selection index needs at least one weighted trait");
    }
    return this.authorized(context, true, async (client) => {
      try {
        const inserted = await client.query(
          `INSERT INTO selection_index (tenant_id, name, version, weights, missing_data_behavior)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [
            context.tenantId,
            input.name,
            input.version,
            JSON.stringify(input.weights),
            input.missingDataBehavior,
          ],
        );
        return { indexId: inserted.rows[0]!.id };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ValidationError(
            `Selection index '${input.name}' version ${input.version} already exists`,
          );
        }
        throw error;
      }
    });
  }

  /**
   * Rank animals by a selection index, exposing every input, normalization,
   * percentile, weight, contribution, and exclusion (JK-GEN-005). Traits are
   * min-max normalized across the candidate set (transparent and bounded).
   */
  async rankAnimals(
    context: TenantContext,
    indexId: Uuid,
    animalIds: Uuid[],
  ): Promise<RankedAnimal[]> {
    if (animalIds.length === 0) throw new ValidationError("animalIds must be non-empty");
    return this.authorized(context, false, async (client) => {
      const idx = await client.query<{
        weights: Record<string, number>;
        missing_data_behavior: string;
      }>(`SELECT weights, missing_data_behavior FROM selection_index WHERE id = $1`, [
        indexId,
      ]);
      if (idx.rows.length === 0)
        throw new NotFoundError(`Selection index ${indexId} not found`);
      const weights = idx.rows[0]!.weights;
      const missing = idx.rows[0]!.missing_data_behavior;
      const traits = Object.keys(weights);

      // Latest value per animal+trait.
      const evals = await client.query<{
        animal_id: string;
        trait: string;
        value: string;
        percentile: string | null;
      }>(
        `SELECT DISTINCT ON (animal_id, trait) animal_id, trait, value, percentile
         FROM genetic_evaluation
         WHERE animal_id = ANY($1) AND trait = ANY($2)
         ORDER BY animal_id, trait, evaluation_date DESC`,
        [animalIds, traits],
      );
      const byAnimalTrait = new Map<
        string,
        { value: number; percentile: number | null }
      >();
      for (const r of evals.rows) {
        byAnimalTrait.set(`${r.animal_id}:${r.trait}`, {
          value: Number(r.value),
          percentile: r.percentile === null ? null : Number(r.percentile),
        });
      }

      // Min/max per trait across the candidate set for normalization.
      const range = new Map<string, { min: number; max: number }>();
      for (const t of traits) {
        const vals = animalIds
          .map((a) => byAnimalTrait.get(`${a}:${t}`)?.value)
          .filter((v): v is number => v !== undefined);
        if (vals.length > 0)
          range.set(t, { min: Math.min(...vals), max: Math.max(...vals) });
      }

      const ranked: RankedAnimal[] = animalIds.map((animalId) => {
        const breakdown: RankedAnimal["breakdown"] = [];
        let score = 0;
        let excluded = false;
        for (const t of traits) {
          const weight = weights[t]!;
          const cell = byAnimalTrait.get(`${animalId}:${t}`);
          const r = range.get(t);
          if (cell === undefined) {
            if (missing === "exclude") {
              excluded = true;
              breakdown.push({
                trait: t,
                rawValue: null,
                normalized: null,
                weight,
                contribution: 0,
                percentile: null,
              });
              continue;
            }
            breakdown.push({
              trait: t,
              rawValue: 0,
              normalized: 0,
              weight,
              contribution: 0,
              percentile: null,
            });
            continue;
          }
          const normalized =
            r && r.max > r.min ? (cell.value - r.min) / (r.max - r.min) : 0.5;
          const contribution = weight * normalized;
          score += contribution;
          breakdown.push({
            trait: t,
            rawValue: cell.value,
            normalized,
            weight,
            contribution,
            percentile: cell.percentile,
          });
        }
        return excluded
          ? {
              animalId,
              score: null,
              excluded: true,
              exclusionReason: "missing required trait (index excludes incomplete data)",
              breakdown,
            }
          : {
              animalId,
              score: Math.round(score * 10000) / 10000,
              excluded: false,
              breakdown,
            };
      });

      // Rank included animals by score descending; excluded go last.
      return ranked.sort((a, b) => {
        if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
        return (b.score ?? -Infinity) - (a.score ?? -Infinity);
      });
    });
  }

  /** Average trait value per birth-year cohort (JK-GEN-006). */
  async geneticProgress(
    context: TenantContext,
    trait: string,
  ): Promise<Array<{ birthYear: number; avgValue: number; count: number }>> {
    return this.authorized(context, false, async (client) => {
      const result = await client.query<{
        birth_year: number;
        avg_value: string;
        n: string;
      }>(
        `SELECT EXTRACT(YEAR FROM a.birth_date)::int AS birth_year,
                AVG(ge.value)::numeric(12,4)::text AS avg_value, count(*)::text AS n
         FROM genetic_evaluation ge
         JOIN animal a ON a.id = ge.animal_id
         WHERE ge.trait = $1 AND a.birth_date IS NOT NULL
         GROUP BY birth_year ORDER BY birth_year`,
        [trait],
      );
      return result.rows.map((r) => ({
        birthYear: r.birth_year,
        avgValue: Number(r.avg_value),
        count: Number(r.n),
      }));
    });
  }

  // -- internals --
  private async nextVersion(
    client: pg.PoolClient,
    tenantId: string,
    animalId: string,
  ): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event WHERE tenant_id = $1 AND aggregate_type = 'animal' AND aggregate_id = $2`,
      [tenantId, animalId],
    );
    return result.rows[0]!.next;
  }

  private parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(
        "Invalid input",
        result.error.issues.map((i) => ({ field: i.path.join("."), reason: i.message })),
      );
    }
    return result.data;
  }

  private async authorized<T>(
    context: TenantContext,
    write: boolean,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const active = memberships.filter((m) => m.status === "active");
      if (active.length === 0)
        return { ok: false as const, reason: "no_active_membership" };
      if (write && !active.some((m) => GENETICS_WRITE_ROLES.has(m.role))) {
        return {
          ok: false as const,
          reason: "genetics changes require genetics_specialist or tenant_owner",
        };
      }
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new ReproForbiddenError(outcome.reason);
    return outcome.value;
  }
}
