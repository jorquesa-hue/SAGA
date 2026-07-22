import { TenantIsolationError, type TenantContext } from "@jk/domain-kernel";
import pg from "pg";

/**
 * RLS-aware database access (JK-SEC-004/005, §67).
 *
 * Two access paths exist by design:
 *  - withTenantTransaction: the ONLY approved path for tenant-scoped business
 *    data. Requires an explicit TenantContext; sets `app.tenant_id` with
 *    SET LOCAL inside the transaction so PostgreSQL Row-Level Security
 *    enforces isolation as defense in depth beneath application checks.
 *  - withSystemTransaction: platform-level operations (tenant onboarding,
 *    migrations, cross-tenant workers). Uses a separately credentialed
 *    connection; every use site is expected to be audited.
 *
 * The tenant id value is passed via a parameterized set_config call — never
 * interpolated into SQL.
 */

export interface DatabaseConfig {
  connectionString: string;
  max?: number;
  applicationName?: string;
}

export function createPool(config: DatabaseConfig): pg.Pool {
  return new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    application_name: config.applicationName ?? "jk-platform",
  });
}

export type TransactionFn<T> = (client: pg.PoolClient) => Promise<T>;

export async function withTenantTransaction<T>(
  pool: pg.Pool,
  context: TenantContext,
  fn: TransactionFn<T>,
): Promise<T> {
  if (!context?.tenantId) {
    throw new TenantIsolationError(
      "withTenantTransaction requires a TenantContext with tenantId",
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL scopes the setting to this transaction only; it can never
    // leak into another pooled request.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      context.tenantId,
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function withSystemTransaction<T>(
  pool: pg.Pool,
  fn: TransactionFn<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
