import { type ActorContext, assertActor } from "./actor.js";
import { TenantIsolationError, ValidationError } from "./errors.js";
import { isUuid, type Uuid } from "./ids.js";

/**
 * TenantContext is the mandatory ambient context for every repository and
 * application-service call (JK-DOM-001, JK-SEC-004, §67). Repositories SHALL
 * require an explicit TenantContext object — never a bare tenant id string —
 * so call sites cannot accidentally drop actor attribution.
 */
export interface TenantContext {
  readonly tenantId: Uuid;
  /** Optional farm scope for farm-scoped operations. */
  readonly farmId?: Uuid;
  readonly actor: ActorContext;
  /** Correlation id propagated across commands, events, jobs, and logs. */
  readonly correlationId: Uuid;
}

export function createTenantContext(input: {
  tenantId: string;
  farmId?: string;
  actor: ActorContext;
  correlationId: string;
}): TenantContext {
  if (!isUuid(input.tenantId)) {
    throw new ValidationError("tenantId must be a UUID");
  }
  if (input.farmId !== undefined && !isUuid(input.farmId)) {
    throw new ValidationError("farmId must be a UUID when provided");
  }
  if (!isUuid(input.correlationId)) {
    throw new ValidationError("correlationId must be a UUID");
  }
  assertActor(input.actor);
  return Object.freeze({
    tenantId: input.tenantId,
    farmId: input.farmId,
    actor: input.actor,
    correlationId: input.correlationId,
  });
}

/**
 * Guard used by repositories and consumers to verify that a record or event
 * envelope belongs to the active tenant (JK §67: "Background jobs and event
 * consumers SHALL verify envelope tenant against payload/resource tenant").
 */
export function assertSameTenant(context: TenantContext, resourceTenantId: string): void {
  if (context.tenantId !== resourceTenantId) {
    throw new TenantIsolationError(
      `Tenant context ${context.tenantId} attempted to access resource of tenant ${resourceTenantId}`,
    );
  }
}
