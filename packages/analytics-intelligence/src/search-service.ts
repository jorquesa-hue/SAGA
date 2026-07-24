import { type TenantContext } from "@jk/domain-kernel";
import { withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { decide, loadCallerMemberships } from "./authorization.js";
import { AnalyticsForbiddenError } from "./errors.js";

/**
 * Global search (§27): find animals, identifiers/RFID, lots, paddocks, and
 * people within the caller's authorization scope. Every query runs inside a
 * tenant transaction (RLS), so results are tenant-isolated by construction;
 * people are reached only through the tenant-scoped membership table so the
 * global user_account is never exposed across tenants.
 */

export interface SearchHit {
  type: "animal" | "lot" | "paddock" | "person";
  id: string;
  label: string;
  sublabel?: string;
}

export interface SearchResults {
  query: string;
  animals: SearchHit[];
  lots: SearchHit[];
  paddocks: SearchHit[];
  people: SearchHit[];
}

export interface SearchServiceOptions {
  appPool: pg.Pool;
}

/** Escape LIKE wildcards so user input is treated literally. */
function likePattern(query: string): string {
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

export class SearchService {
  private readonly appPool: pg.Pool;

  constructor(options: SearchServiceOptions) {
    this.appPool = options.appPool;
  }

  async search(
    context: TenantContext,
    rawQuery: string,
    limit = 8,
  ): Promise<SearchResults> {
    const query = (rawQuery ?? "").trim();
    const empty: SearchResults = {
      query,
      animals: [],
      lots: [],
      paddocks: [],
      people: [],
    };
    if (query.length < 1) return empty;
    const pattern = likePattern(query);
    const cap = Math.min(Math.max(limit, 1), 25);

    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide("read", context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };

      // Animals: by visual id or by any assigned identifier value (RFID/official).
      const animals = await client.query<{
        id: string;
        visual_id: string;
        lifecycle_status: string;
        identifier_value: string | null;
      }>(
        `SELECT a.id, a.visual_id, a.lifecycle_status,
                (SELECT ai.identifier_value FROM animal_identifier ai
                  WHERE ai.animal_id = a.id AND ai.identifier_value ILIKE $1 LIMIT 1) AS identifier_value
           FROM animal a
          WHERE a.visual_id ILIKE $1
             OR EXISTS (SELECT 1 FROM animal_identifier ai WHERE ai.animal_id = a.id AND ai.identifier_value ILIKE $1)
          ORDER BY a.visual_id
          LIMIT $2`,
        [pattern, cap],
      );
      const lots = await client.query<{ id: string; name: string; status: string }>(
        `SELECT id, name, status FROM lot WHERE name ILIKE $1 ORDER BY name LIMIT $2`,
        [pattern, cap],
      );
      const paddocks = await client.query<{ id: string; name: string; status: string }>(
        `SELECT id, name, status FROM paddock WHERE name ILIKE $1 ORDER BY name LIMIT $2`,
        [pattern, cap],
      );
      // People: only this tenant's members (join through the RLS-scoped table).
      const people = await client.query<{
        id: string;
        display_name: string;
        email: string;
        role: string;
      }>(
        `SELECT u.id, u.display_name, u.email, m.role
           FROM tenant_membership m
           JOIN user_account u ON u.id = m.user_id
          WHERE m.valid_to IS NULL
            AND (u.display_name ILIKE $1 OR u.email ILIKE $1)
          ORDER BY u.display_name
          LIMIT $2`,
        [pattern, cap],
      );

      const results: SearchResults = {
        query,
        animals: animals.rows.map((r) => ({
          type: "animal",
          id: r.id,
          label: r.visual_id,
          sublabel: r.identifier_value
            ? `RFID ${r.identifier_value}`
            : r.lifecycle_status,
        })),
        lots: lots.rows.map((r) => ({
          type: "lot",
          id: r.id,
          label: r.name,
          sublabel: r.status,
        })),
        paddocks: paddocks.rows.map((r) => ({
          type: "paddock",
          id: r.id,
          label: r.name,
          sublabel: r.status,
        })),
        people: people.rows.map((r) => ({
          type: "person",
          id: r.id,
          label: r.display_name,
          sublabel: `${r.role} · ${r.email}`,
        })),
      };
      return { ok: true as const, results };
    });

    if (!outcome.ok)
      throw new AnalyticsForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.results;
  }
}
