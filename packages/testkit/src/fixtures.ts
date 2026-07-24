import {
  createTenantContext,
  newUuid,
  type ActorContext,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import { IdentityService } from "@jk/identity-tenancy";
import type pg from "pg";
import type { TestDatabase } from "./pg-harness.js";

/**
 * Fixture builders for integration and isolation tests. They compose the real
 * IdentityService over the harness pools so tests exercise production code
 * paths, not test-only shortcuts.
 */

export function makeActor(userId: Uuid = newUuid()): ActorContext {
  return { type: "user", id: userId, display: "Test User" };
}

export function makeTenantContext(
  tenantId: Uuid,
  userId: Uuid = newUuid(),
  correlationId: Uuid = newUuid(),
): TenantContext {
  return createTenantContext({
    tenantId,
    actor: makeActor(userId),
    correlationId,
  });
}

export function makeIdentityService(db: TestDatabase): IdentityService {
  return new IdentityService({
    systemPool: db.adminPool,
    appPool: db.appPool,
    environment: "test",
  });
}

export interface SeededTenant {
  tenantId: Uuid;
  ownerUserId: Uuid;
  ownerContext: TenantContext;
}

/**
 * Create a tenant with a bootstrapped active tenant_owner and return an owner
 * TenantContext ready to perform tenant-scoped operations.
 */
export async function seedTenantWithOwner(
  service: IdentityService,
  name: string,
  ownerEmail: string,
): Promise<SeededTenant> {
  const result = await service.createTenant(
    { name, owner: { email: ownerEmail, displayName: `${name} Owner` } },
    { type: "service", id: "testkit-seed" },
  );
  if (!result.ownerUserId) {
    throw new Error("seedTenantWithOwner expected an owner to be bootstrapped");
  }
  return {
    tenantId: result.tenant.id,
    ownerUserId: result.ownerUserId,
    ownerContext: makeTenantContext(result.tenant.id, result.ownerUserId),
  };
}

/** Count rows visible to a pool under an explicit tenant setting (or none). */
export async function countUnderTenant(
  pool: pg.Pool,
  tenantId: Uuid | null,
  table: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId ?? ""]);
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table}`,
    );
    await client.query("COMMIT");
    return Number(result.rows[0]!.n);
  } finally {
    client.release();
  }
}
