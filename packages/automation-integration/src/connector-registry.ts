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
import { IntegrationForbiddenError } from "./errors.js";

/**
 * Connector framework (§33). Every connector adapter sits behind a stable
 * domain-facing interface and MUST declare its authentication, retry,
 * idempotency, rate-limit, reconciliation, observability, versioning, and
 * failure-mode contract. Vendor protocol detail never leaks into domain
 * models. A `ConnectorRegistration` records a tenant-scoped install of an
 * adapter; secrets are referenced (`secretRef`), never stored inline.
 */

export type ConnectorType =
  | "rfid_reader"
  | "electronic_scale"
  | "edge_gateway"
  | "csv_xlsx_import"
  | "laboratory_result"
  | "genetics_evaluation"
  | "identity_provider"
  | "messaging_provider"
  | "accounting_export"
  | "geospatial_provider"
  | "object_storage"
  | "webhook";

/** The §33 contract every connector adapter must declare. */
export interface ConnectorContract {
  authentication: "hmac" | "oauth2" | "api_key" | "mtls" | "none";
  idempotent: boolean;
  retry: { maxAttempts: number; backoff: "exponential" | "fixed" | "none" };
  rateLimitPerMinute: number | null;
  reconciliation: "delivery_log" | "checkpoint" | "manual" | "none";
  observability: "structured_logs" | "metrics" | "traces";
  version: string;
  failureMode: "dead_letter" | "reject" | "degrade";
}

/** Stable domain-facing adapter interface. */
export interface ConnectorAdapter {
  readonly type: ConnectorType;
  readonly contract: ConnectorContract;
}

/** In-process descriptor registry of the adapters this build ships. */
export class ConnectorAdapterRegistry {
  private readonly adapters = new Map<ConnectorType, ConnectorAdapter>();

  register(adapter: ConnectorAdapter): this {
    this.adapters.set(adapter.type, adapter);
    return this;
  }
  get(type: ConnectorType): ConnectorAdapter | undefined {
    return this.adapters.get(type);
  }
  list(): ConnectorAdapter[] {
    return [...this.adapters.values()];
  }
}

/** The built-in webhook connector's §33 contract (implemented in this slice). */
export const WEBHOOK_ADAPTER: ConnectorAdapter = {
  type: "webhook",
  contract: {
    authentication: "hmac",
    idempotent: true,
    retry: { maxAttempts: 6, backoff: "exponential" },
    rateLimitPerMinute: null,
    reconciliation: "delivery_log",
    observability: "structured_logs",
    version: "1.0",
    failureMode: "dead_letter",
  },
};

export const CONNECTOR_REGISTERED = "connector.connector_registered.v1";

export const registerConnectorInputSchema = z
  .object({
    connectorType: z.enum([
      "rfid_reader",
      "electronic_scale",
      "edge_gateway",
      "csv_xlsx_import",
      "laboratory_result",
      "genetics_evaluation",
      "identity_provider",
      "messaging_provider",
      "accounting_export",
      "geospatial_provider",
      "object_storage",
      "webhook",
    ]),
    name: z.string().min(1).max(120),
    config: z.record(z.unknown()).default({}),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type RegisterConnectorInput = z.input<typeof registerConnectorInputSchema>;

export interface ConnectorRegistration {
  id: Uuid;
  connectorType: string;
  name: string;
  status: string;
}

export interface ConnectorRegistryServiceOptions {
  appPool: pg.Pool;
  environment?: string;
}

export class ConnectorRegistryService {
  private readonly appPool: pg.Pool;
  private readonly environment: string;

  constructor(options: ConnectorRegistryServiceOptions) {
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
  }

  async registerConnector(context: TenantContext, rawInput: RegisterConnectorInput): Promise<ConnectorRegistration> {
    const input = parse(registerConnectorInputSchema, rawInput);
    return this.manage(context, async (client) => {
      const id = newUuid();
      const append = await appendEvent(
        client,
        createEventEnvelope({
          eventType: CONNECTOR_REGISTERED,
          context,
          aggregateType: "connector",
          aggregateId: id,
          aggregateVersion: 1,
          source: { channel: "system" },
          idempotencyKey: input.idempotencyKey ?? `connector-${id}`,
          payload: { connectorId: id, connectorType: input.connectorType, name: input.name },
        }),
        { environment: this.environment },
      );
      await client.query(
        `INSERT INTO connector_registration (id, tenant_id, connector_type, name, config, status, event_id)
         VALUES ($1,$2,$3,$4,$5,'active',$6)`,
        [id, context.tenantId, input.connectorType, input.name, JSON.stringify(input.config), append.eventId],
      );
      return { id, connectorType: input.connectorType, name: input.name, status: "active" };
    });
  }

  async listConnectors(context: TenantContext): Promise<ConnectorRegistration[]> {
    return this.read(context, async (client) => {
      const result = await client.query<{ id: Uuid; connector_type: string; name: string; status: string }>(
        `SELECT id, connector_type, name, status FROM connector_registration ORDER BY created_at DESC`,
      );
      return result.rows.map((r) => ({ id: r.id, connectorType: r.connector_type, name: r.name, status: r.status }));
    });
  }

  async getConnector(context: TenantContext, id: Uuid): Promise<ConnectorRegistration> {
    return this.read(context, async (client) => {
      const result = await client.query<{ id: Uuid; connector_type: string; name: string; status: string }>(
        `SELECT id, connector_type, name, status FROM connector_registration WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) throw new NotFoundError(`Connector ${id} not found`);
      const r = result.rows[0]!;
      return { id: r.id, connectorType: r.connector_type, name: r.name, status: r.status };
    });
  }

  private async manage<T>(context: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide("manage_integrations", context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new IntegrationForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }

  private async read<T>(context: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const outcome = await withTenantTransaction(this.appPool, context, async (client) => {
      const memberships = await loadCallerMemberships(client, context);
      const decision = decide("read", context, memberships);
      if (!decision.allowed) return { ok: false as const, decision };
      return { ok: true as const, value: await fn(client) };
    });
    if (!outcome.ok) throw new IntegrationForbiddenError(outcome.decision.reason, outcome.decision);
    return outcome.value;
  }
}

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      "Invalid input",
      result.error.issues.map((i) => ({ field: i.path.join("."), reason: i.message })),
    );
  }
  return result.data;
}
