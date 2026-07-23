import {
  assertActor,
  ConflictError,
  createEventEnvelope,
  createTenantContext,
  isUuid,
  newUuid,
  NotFoundError,
  type ActorContext,
  type SourceContext,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import { appendEvent, withSystemTransaction, withTenantTransaction } from "@jk/database";
import type pg from "pg";
import { writeAuditRecord } from "./audit.js";
import {
  AuthorizationPolicy,
  type AuthorizationDecision,
  type AuthorizationResource,
  type CallerMembership,
  type IdentityAction,
} from "./authorization.js";
import {
  createFarmInputSchema,
  createTenantInputSchema,
  inviteUserInputSchema,
  mapFarmRow,
  mapMembershipRow,
  mapTenantRow,
  membershipChangeInputSchema,
  parseInput,
  updateTenantSettingsInputSchema,
  type CreateFarmInput,
  type CreateTenantInput,
  type Farm,
  type FarmRow,
  type InviteUserInput,
  type MembershipChangeInput,
  type Tenant,
  type UpdateTenantSettingsInput,
  type TenantMember,
  type TenantMembership,
  type TenantMembershipRow,
  type TenantRow,
  type UserAccountStatus,
} from "./domain.js";
import { ForbiddenError } from "./errors.js";
import { type Role } from "./roles.js";

/**
 * Identity and Tenancy application service (JK-IAM-001..006, §7, §17, §66-§68).
 *
 * Two database paths by design (§67):
 *  - system pool + withSystemTransaction ONLY for tenant onboarding, which is
 *    a platform-level operation (there is no tenant context before the tenant
 *    exists);
 *  - app pool + withTenantTransaction for every tenant-scoped operation, so
 *    PostgreSQL RLS enforces isolation beneath the application checks.
 *
 * Every write appends its canonical domain event through the transactional
 * outbox (same transaction) and an audit_record (§68). Authorization is
 * decided by the central policy from memberships loaded INSIDE the same
 * transaction that performs the write; denials are audited and thrown with
 * an explicit reason (§66).
 */

export interface IdentityServiceOptions {
  /** Owner/system credentials — used exclusively for tenant onboarding. */
  systemPool: pg.Pool;
  /** RLS-enforced application role credentials (jk_app). */
  appPool: pg.Pool;
  /** Event subject environment segment (§49); defaults to "local". */
  environment?: string;
  policy?: AuthorizationPolicy;
}

export interface CreateTenantResult {
  tenant: Tenant;
  /** Present when the input bootstrapped the initial tenant_owner. */
  ownerUserId: Uuid | null;
}

export interface InviteUserResult {
  userId: Uuid;
  membershipId: Uuid;
  role: Role;
  status: "invited";
  userStatus: UserAccountStatus;
}

type AuthorizedOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; decision: AuthorizationDecision };

export class IdentityService {
  private readonly systemPool: pg.Pool;
  private readonly appPool: pg.Pool;
  private readonly environment: string;
  private readonly policy: AuthorizationPolicy;

  constructor(options: IdentityServiceOptions) {
    this.systemPool = options.systemPool;
    this.appPool = options.appPool;
    this.environment = options.environment ?? "local";
    this.policy = options.policy ?? new AuthorizationPolicy();
  }

  // -------------------------------------------------------------------------
  // Platform-level: tenant onboarding
  // -------------------------------------------------------------------------

  /**
   * Create a tenant (platform operation — no TenantContext exists yet).
   * Optionally bootstraps the initial tenant_owner so the tenant is
   * administrable from birth. Appends identity.tenant_created.v1 (and
   * identity.membership_activated.v1 for the bootstrapped owner) plus audit
   * records, all in one system transaction.
   */
  async createTenant(
    rawInput: CreateTenantInput,
    actor: ActorContext,
  ): Promise<CreateTenantResult> {
    const input = parseInput(createTenantInputSchema, rawInput, "createTenant input");
    assertActor(actor);
    const tenantId = newUuid();
    const correlationId = input.correlationId ?? newUuid();
    const source: SourceContext = { channel: "system" };

    return withSystemTransaction(this.systemPool, async (client) => {
      const inserted = await client.query<TenantRow>(
        `INSERT INTO tenant (id, name, default_locale, default_currency, status)
         VALUES ($1, $2, COALESCE($3, 'pt-BR'), COALESCE($4, 'BRL'), 'active')
         RETURNING id, name, default_locale, default_currency, status, created_at`,
        [tenantId, input.name, input.defaultLocale ?? null, input.defaultCurrency ?? null],
      );
      const tenant = mapTenantRow(inserted.rows[0]!);

      // The context is created only now that the tenant id exists; the actor
      // is the platform operator performing the onboarding.
      const context = createTenantContext({ tenantId, actor, correlationId });

      let ownerUserId: Uuid | null = null;
      if (input.owner) {
        // System credentials see the whole user directory (platform-level
        // identity); reuse an existing account or create one with an
        // app-generated id. No ON CONFLICT/RETURNING: under FORCE RLS those
        // clauses enforce SELECT policies against the new row.
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM user_account WHERE lower(email) = lower($1)`,
          [input.owner.email],
        );
        if (existing.rows.length > 0) {
          ownerUserId = existing.rows[0]!.id;
          await client.query(`UPDATE user_account SET updated_at = now() WHERE id = $1`, [
            ownerUserId,
          ]);
        } else {
          ownerUserId = newUuid();
          await client.query(
            `INSERT INTO user_account (id, email, display_name, status)
             VALUES ($1, $2, $3, 'active')`,
            [ownerUserId, input.owner.email, input.owner.displayName],
          );
        }
        await client.query(
          `INSERT INTO tenant_membership (id, tenant_id, user_id, role, status)
           VALUES ($1, $2, $3, 'tenant_owner', 'active')`,
          [newUuid(), tenantId, ownerUserId],
        );
      }

      const version = await this.nextAggregateVersion(client, tenantId, "tenant", tenantId);
      await appendEvent(
        client,
        createEventEnvelope({
          eventType: "identity.tenant_created.v1",
          context,
          farmId: null,
          aggregateType: "tenant",
          aggregateId: tenantId,
          aggregateVersion: version,
          source,
          idempotencyKey: input.idempotencyKey ?? `tenant-create-${tenantId}`,
          payload: {
            tenantId,
            name: tenant.name,
            defaultLocale: tenant.defaultLocale,
            defaultCurrency: tenant.defaultCurrency,
            ownerUserId,
          },
        }),
        { environment: this.environment },
      );

      if (ownerUserId !== null) {
        const ownerVersion = await this.nextAggregateVersion(
          client,
          tenantId,
          "user",
          ownerUserId,
        );
        await appendEvent(
          client,
          createEventEnvelope({
            eventType: "identity.membership_activated.v1",
            context,
            farmId: null,
            aggregateType: "user",
            aggregateId: ownerUserId,
            aggregateVersion: ownerVersion,
            source,
            idempotencyKey: `membership-activate-${tenantId}-${ownerUserId}-tenant_owner`,
            payload: { userId: ownerUserId, role: "tenant_owner", bootstrap: true },
          }),
          { environment: this.environment },
        );
      }

      await writeAuditRecord(client, {
        tenantId,
        actor,
        action: "identity.tenant.created",
        resourceType: "tenant",
        resourceId: tenantId,
        outcome: "success",
        correlationId,
        detail: { name: tenant.name, ownerUserId },
      });

      return { tenant, ownerUserId };
    });
  }

  // -------------------------------------------------------------------------
  // Tenant-scoped writes
  // -------------------------------------------------------------------------

  /** Create a farm (manage_farms: tenant_owner | farm_manager). */
  async createFarm(context: TenantContext, rawInput: CreateFarmInput): Promise<Farm> {
    const input = parseInput(createFarmInputSchema, rawInput, "createFarm input");
    const farmId = newUuid();
    return this.authorized(
      context,
      "manage_farms",
      { type: "farm", id: farmId },
      async (client) => {
        let row: FarmRow;
        try {
          const inserted = await client.query<FarmRow>(
            `INSERT INTO farm (id, tenant_id, name, timezone, area_ha)
             VALUES ($1, $2, $3, COALESCE($4, 'America/Sao_Paulo'), $5)
             RETURNING id, tenant_id, name, timezone, area_ha, created_at`,
            [farmId, context.tenantId, input.name, input.timezone ?? null, input.areaHa ?? null],
          );
          row = inserted.rows[0]!;
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw new ConflictError(
              `A farm named '${input.name}' already exists in this tenant`,
            );
          }
          throw error;
        }
        const farm = mapFarmRow(row);

        const version = await this.nextAggregateVersion(
          client,
          context.tenantId,
          "farm",
          farmId,
        );
        await appendEvent(
          client,
          createEventEnvelope({
            eventType: "identity.farm_created.v1",
            context,
            farmId,
            aggregateType: "farm",
            aggregateId: farmId,
            aggregateVersion: version,
            source: { channel: "api" },
            idempotencyKey: input.idempotencyKey ?? `farm-create-${farmId}`,
            payload: {
              farmId,
              name: farm.name,
              timezone: farm.timezone,
              areaHa: farm.areaHa,
            },
          }),
          { environment: this.environment },
        );

        await writeAuditRecord(client, {
          tenantId: context.tenantId,
          actor: context.actor,
          action: "identity.farm.created",
          resourceType: "farm",
          resourceId: farmId,
          outcome: "success",
          correlationId: context.correlationId,
          detail: { name: farm.name },
        });

        return farm;
      },
    );
  }

  /**
   * Invite a user into the tenant (invite_users: tenant_owner). Creates the
   * platform user account when the email is new; creates an invited
   * membership; appends identity.user_invited.v1.
   *
   * Tenant-isolation note: user accounts are platform-level but RLS makes
   * them visible only through a membership in the active tenant. An email
   * that already exists on the platform WITHOUT a membership here is
   * indistinguishable from a forbidden read — the invite is rejected with a
   * ConflictError; linking an existing platform user into another tenant is
   * a platform-level operation outside this Phase 0 slice.
   */
  async inviteUser(
    context: TenantContext,
    rawInput: InviteUserInput,
  ): Promise<InviteUserResult> {
    const input = parseInput(inviteUserInputSchema, rawInput, "inviteUser input");
    return this.authorized(
      context,
      "invite_users",
      { type: "user" },
      async (client) => {
        const existing = await client.query<{ id: string; status: UserAccountStatus }>(
          `SELECT id, status FROM user_account WHERE lower(email) = lower($1)`,
          [input.email],
        );

        let userId: Uuid;
        let userStatus: UserAccountStatus;
        if (existing.rows.length > 0) {
          userId = existing.rows[0]!.id;
          userStatus = existing.rows[0]!.status;
        } else {
          // Plain INSERT with an app-generated id. ON CONFLICT / RETURNING
          // are unusable here: under FORCE RLS they enforce the SELECT
          // policy against the new row, and a user has no membership yet.
          // A unique violation therefore means the email exists platform-
          // wide but is invisible in this tenant (see doc above).
          userId = newUuid();
          userStatus = "invited";
          try {
            await client.query(
              `INSERT INTO user_account (id, email, display_name, status)
               VALUES ($1, $2, $3, 'invited')`,
              [userId, input.email, input.displayName],
            );
          } catch (error) {
            if ((error as { code?: string }).code === "23505") {
              throw new ConflictError(
                "A platform user with this email already exists outside this tenant; " +
                  "cross-tenant linking requires a platform-level operation",
              );
            }
            throw error;
          }
        }

        const duplicate = await client.query(
          `SELECT 1 FROM tenant_membership
           WHERE tenant_id = $1 AND user_id = $2 AND role = $3 AND valid_to IS NULL`,
          [context.tenantId, userId, input.role],
        );
        if (duplicate.rows.length > 0) {
          throw new ConflictError(
            `User already holds an open '${input.role}' membership in this tenant`,
          );
        }

        const membershipId = newUuid();
        await client.query(
          `INSERT INTO tenant_membership (id, tenant_id, user_id, role, status)
           VALUES ($1, $2, $3, $4, 'invited')`,
          [membershipId, context.tenantId, userId, input.role],
        );

        const version = await this.nextAggregateVersion(
          client,
          context.tenantId,
          "user",
          userId,
        );
        await appendEvent(
          client,
          createEventEnvelope({
            eventType: "identity.user_invited.v1",
            context,
            farmId: null,
            aggregateType: "user",
            aggregateId: userId,
            aggregateVersion: version,
            source: { channel: "api" },
            idempotencyKey:
              input.idempotencyKey ?? `user-invite-${context.tenantId}-${userId}-${input.role}`,
            payload: {
              userId,
              email: input.email,
              displayName: input.displayName,
              role: input.role,
              membershipId,
            },
          }),
          { environment: this.environment },
        );

        await writeAuditRecord(client, {
          tenantId: context.tenantId,
          actor: context.actor,
          action: "identity.user.invited",
          resourceType: "user",
          resourceId: userId,
          outcome: "success",
          correlationId: context.correlationId,
          detail: { role: input.role, membershipId },
        });

        return { userId, membershipId, role: input.role, status: "invited", userStatus };
      },
    );
  }

  /** Activate an invited membership (manage_members: tenant_owner). */
  async activateMembership(
    context: TenantContext,
    rawInput: MembershipChangeInput,
  ): Promise<TenantMembership> {
    const input = parseInput(
      membershipChangeInputSchema,
      rawInput,
      "activateMembership input",
    );
    return this.authorized(
      context,
      "manage_members",
      { type: "membership", id: input.userId },
      async (client) => {
        const updated = await client.query<TenantMembershipRow>(
          `UPDATE tenant_membership
           SET status = 'active'
           WHERE tenant_id = $1 AND user_id = $2 AND role = $3 AND valid_to IS NULL
           RETURNING id, tenant_id, user_id, role, status, valid_from, valid_to, created_at`,
          [context.tenantId, input.userId, input.role],
        );
        if (updated.rows.length === 0) {
          throw new NotFoundError(
            `No open '${input.role}' membership for user ${input.userId} in this tenant`,
          );
        }
        const membership = mapMembershipRow(updated.rows[0]!);

        // The user accepted / was activated: invited accounts become active.
        await client.query(
          `UPDATE user_account SET status = 'active', updated_at = now()
           WHERE id = $1 AND status = 'invited'`,
          [input.userId],
        );

        const version = await this.nextAggregateVersion(
          client,
          context.tenantId,
          "user",
          input.userId,
        );
        await appendEvent(
          client,
          createEventEnvelope({
            eventType: "identity.membership_activated.v1",
            context,
            farmId: null,
            aggregateType: "user",
            aggregateId: input.userId,
            aggregateVersion: version,
            source: { channel: "api" },
            idempotencyKey:
              input.idempotencyKey ??
              `membership-activate-${context.tenantId}-${input.userId}-${input.role}`,
            payload: { userId: input.userId, role: input.role, membershipId: membership.id },
          }),
          { environment: this.environment },
        );

        await writeAuditRecord(client, {
          tenantId: context.tenantId,
          actor: context.actor,
          action: "identity.membership.activated",
          resourceType: "membership",
          resourceId: membership.id,
          outcome: "success",
          correlationId: context.correlationId,
          detail: { userId: input.userId, role: input.role },
        });

        return membership;
      },
    );
  }

  /**
   * Revoke a membership (manage_members: tenant_owner). Sets status and
   * valid_to — NEVER deletes; historical authorship is preserved
   * (JK-IAM-005).
   */
  async revokeMembership(
    context: TenantContext,
    rawInput: MembershipChangeInput,
  ): Promise<TenantMembership> {
    const input = parseInput(
      membershipChangeInputSchema,
      rawInput,
      "revokeMembership input",
    );
    return this.authorized(
      context,
      "manage_members",
      { type: "membership", id: input.userId },
      async (client) => {
        const updated = await client.query<TenantMembershipRow>(
          `UPDATE tenant_membership
           SET status = 'revoked', valid_to = now()
           WHERE tenant_id = $1 AND user_id = $2 AND role = $3 AND valid_to IS NULL
           RETURNING id, tenant_id, user_id, role, status, valid_from, valid_to, created_at`,
          [context.tenantId, input.userId, input.role],
        );
        if (updated.rows.length === 0) {
          throw new NotFoundError(
            `No open '${input.role}' membership for user ${input.userId} in this tenant`,
          );
        }
        const membership = mapMembershipRow(updated.rows[0]!);

        const version = await this.nextAggregateVersion(
          client,
          context.tenantId,
          "user",
          input.userId,
        );
        await appendEvent(
          client,
          createEventEnvelope({
            eventType: "identity.membership_revoked.v1",
            context,
            farmId: null,
            aggregateType: "user",
            aggregateId: input.userId,
            aggregateVersion: version,
            source: { channel: "api" },
            idempotencyKey:
              input.idempotencyKey ??
              `membership-revoke-${context.tenantId}-${input.userId}-${input.role}-${membership.id}`,
            payload: {
              userId: input.userId,
              role: input.role,
              membershipId: membership.id,
              revokedAt: membership.validTo?.toISOString() ?? null,
            },
          }),
          { environment: this.environment },
        );

        await writeAuditRecord(client, {
          tenantId: context.tenantId,
          actor: context.actor,
          action: "identity.membership.revoked",
          resourceType: "membership",
          resourceId: membership.id,
          outcome: "success",
          correlationId: context.correlationId,
          detail: { userId: input.userId, role: input.role },
        });

        return membership;
      },
    );
  }

  // -------------------------------------------------------------------------
  // Tenant-scoped reads (read: any active membership)
  // -------------------------------------------------------------------------

  async getTenant(context: TenantContext): Promise<Tenant> {
    return this.authorized(context, "read", { type: "tenant", id: context.tenantId }, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT id, name, default_locale, default_currency, status, created_at
         FROM tenant WHERE id = $1`,
        [context.tenantId],
      );
      if (result.rows.length === 0) {
        throw new NotFoundError(`Tenant ${context.tenantId} not found`);
      }
      return mapTenantRow(result.rows[0]!);
    });
  }

  /**
   * Update the active tenant's configurable settings — base locale and/or
   * currency (manage_tenant: tenant_owner). Appends
   * identity.tenant_settings_updated.v1 and an audit record so the change is
   * traceable; unspecified fields are left unchanged.
   */
  async updateTenant(context: TenantContext, rawInput: UpdateTenantSettingsInput): Promise<Tenant> {
    const input = parseInput(updateTenantSettingsInputSchema, rawInput, "updateTenant input");
    return this.authorized(
      context,
      "manage_tenant",
      { type: "tenant", id: context.tenantId },
      async (client) => {
        const result = await client.query<TenantRow>(
          `UPDATE tenant
              SET default_locale = COALESCE($2, default_locale),
                  default_currency = COALESCE($3, default_currency)
            WHERE id = $1
            RETURNING id, name, default_locale, default_currency, status, created_at`,
          [context.tenantId, input.defaultLocale ?? null, input.defaultCurrency ?? null],
        );
        if (result.rows.length === 0) {
          throw new NotFoundError(`Tenant ${context.tenantId} not found`);
        }
        const tenant = mapTenantRow(result.rows[0]!);

        const version = await this.nextAggregateVersion(client, context.tenantId, "tenant", context.tenantId);
        await appendEvent(
          client,
          createEventEnvelope({
            eventType: "identity.tenant_settings_updated.v1",
            context,
            farmId: null,
            aggregateType: "tenant",
            aggregateId: context.tenantId,
            aggregateVersion: version,
            source: { channel: "api" },
            idempotencyKey: input.idempotencyKey ?? `tenant-settings-${context.tenantId}-${version}`,
            payload: {
              tenantId: context.tenantId,
              defaultLocale: tenant.defaultLocale,
              defaultCurrency: tenant.defaultCurrency,
            },
          }),
          { environment: this.environment },
        );

        await writeAuditRecord(client, {
          tenantId: context.tenantId,
          actor: context.actor,
          action: "identity.tenant.settings_updated",
          resourceType: "tenant",
          resourceId: context.tenantId,
          outcome: "success",
          correlationId: context.correlationId,
          detail: { defaultLocale: tenant.defaultLocale, defaultCurrency: tenant.defaultCurrency },
        });

        return tenant;
      },
    );
  }

  async listFarms(context: TenantContext): Promise<Farm[]> {
    return this.authorized(context, "read", { type: "farm" }, async (client) => {
      const result = await client.query<FarmRow>(
        `SELECT id, tenant_id, name, timezone, area_ha, created_at
         FROM farm ORDER BY name`,
      );
      return result.rows.map(mapFarmRow);
    });
  }

  /** Full membership history including revoked rows (JK-IAM-005). */
  async listMembers(context: TenantContext): Promise<TenantMember[]> {
    return this.authorized(context, "read", { type: "membership" }, async (client) => {
      const result = await client.query<
        TenantMembershipRow & {
          email: string;
          display_name: string;
          user_status: UserAccountStatus;
        }
      >(
        `SELECT m.id, m.tenant_id, m.user_id, m.role, m.status,
                m.valid_from, m.valid_to, m.created_at,
                u.email, u.display_name, u.status AS user_status
         FROM tenant_membership m
         JOIN user_account u ON u.id = m.user_id
         ORDER BY u.display_name, m.role, m.valid_from`,
      );
      return result.rows.map((row) => ({
        ...mapMembershipRow(row),
        email: row.email,
        displayName: row.display_name,
        userStatus: row.user_status,
      }));
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Run `fn` inside a tenant transaction after enforcing the authorization
   * policy against memberships loaded in that SAME transaction (§66-§67).
   * A denial commits only its audit_record (outcome 'denied') and throws
   * ForbiddenError with the policy reason; nothing else is written.
   */
  private async authorized<T>(
    context: TenantContext,
    action: IdentityAction,
    resource: AuthorizationResource,
    fn: (client: pg.PoolClient, memberships: readonly CallerMembership[]) => Promise<T>,
  ): Promise<T> {
    const outcome = await withTenantTransaction(
      this.appPool,
      context,
      async (client): Promise<AuthorizedOutcome<T>> => {
        const memberships = await this.loadCallerMemberships(client, context);
        const decision = this.policy.decide({ context, action, memberships, resource });
        if (!decision.allowed) {
          await writeAuditRecord(client, {
            tenantId: context.tenantId,
            actor: context.actor,
            action: `identity.${action}`,
            resourceType: resource.type,
            resourceId: resource.id ?? null,
            outcome: "denied",
            correlationId: context.correlationId,
            detail: { reason: decision.reason },
          });
          return { ok: false, decision };
        }
        return { ok: true, value: await fn(client, memberships) };
      },
    );
    if (!outcome.ok) {
      throw new ForbiddenError(outcome.decision.reason, outcome.decision);
    }
    return outcome.value;
  }

  /**
   * Load the caller's open memberships in the active tenant. RLS already
   * scopes rows to context.tenantId; the explicit filter keeps intent
   * visible and is a second guard (§67 defense in depth).
   */
  private async loadCallerMemberships(
    client: pg.PoolClient,
    context: TenantContext,
  ): Promise<CallerMembership[]> {
    if (context.actor.type !== "user" || !isUuid(context.actor.id)) {
      return [];
    }
    const result = await client.query<CallerMembership>(
      `SELECT role, status FROM tenant_membership
       WHERE tenant_id = $1 AND user_id = $2 AND valid_to IS NULL`,
      [context.tenantId, context.actor.id],
    );
    return result.rows;
  }

  /** Next aggregate_version for an aggregate, inside the open transaction. */
  private async nextAggregateVersion(
    client: pg.PoolClient,
    tenantId: Uuid,
    aggregateType: string,
    aggregateId: Uuid,
  ): Promise<number> {
    const result = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(aggregate_version), 0)::int + 1 AS next
       FROM domain_event
       WHERE tenant_id = $1 AND aggregate_type = $2 AND aggregate_id = $3`,
      [tenantId, aggregateType, aggregateId],
    );
    return result.rows[0]!.next;
  }
}
