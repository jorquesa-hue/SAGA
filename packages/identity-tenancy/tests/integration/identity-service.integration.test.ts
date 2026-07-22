import {
  ConflictError,
  createTenantContext,
  newUuid,
  NotFoundError,
  type TenantContext,
  type Uuid,
} from "@jk/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../../src/errors.js";
import { IdentityService } from "../../src/identity-service.js";
import { createTestDatabase, databaseAvailable, type TestDatabase } from "./setup.js";

const available = databaseAvailable();

/**
 * Full-path integration suite for the Identity and Tenancy context
 * (JK-IAM-001..006, §66-§68) against a real PostgreSQL with RLS:
 * tenant -> farm -> invite -> activate -> revoke, plus negative paths
 * (cross-tenant denial, non-owner invite denial, duplicate conflicts) and
 * ledger integrity (events + outbox + audit).
 */

describe.skipIf(!available)("IdentityService (real PostgreSQL)", () => {
  let db: TestDatabase;
  let service: IdentityService;

  let tenantAId: Uuid;
  let tenantBId: Uuid;
  let anaId: Uuid; // tenant_owner of Fazenda Aurora (tenant A)
  let brunoId: Uuid; // tenant_owner of Rancho Boa Vista (tenant B)
  let carlosId: Uuid; // technician invited into tenant A
  let _farmSedeId: Uuid;

  const contextFor = (tenantId: string, userId: string): TenantContext =>
    createTenantContext({
      tenantId,
      actor: { type: "user", id: userId },
      correlationId: newUuid(),
    });

  beforeAll(async () => {
    db = await createTestDatabase("jk_idt");
    service = new IdentityService({
      systemPool: db.adminPool,
      appPool: db.appPool,
      environment: "test",
    });

    const a = await service.createTenant(
      {
        name: "Fazenda Aurora",
        owner: { email: "ana.souza@example.com", displayName: "Ana Souza" },
      },
      { type: "user", id: newUuid(), display: "Plataforma JK" },
    );
    tenantAId = a.tenant.id;
    anaId = a.ownerUserId!;

    const b = await service.createTenant(
      {
        name: "Rancho Boa Vista",
        defaultLocale: "pt-BR",
        defaultCurrency: "BRL",
        owner: { email: "bruno.lima@example.com", displayName: "Bruno Lima" },
      },
      { type: "user", id: newUuid(), display: "Plataforma JK" },
    );
    tenantBId = b.tenant.id;
    brunoId = b.ownerUserId!;
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
  });

  // -------------------------------------------------------------------------
  // Tenant onboarding (system-level)
  // -------------------------------------------------------------------------

  it("creates the tenant with defaults, owner membership, events, outbox, and audit", async () => {
    const tenant = await db.adminPool.query(
      `SELECT name, default_locale, default_currency, status FROM tenant WHERE id = $1`,
      [tenantAId],
    );
    expect(tenant.rows[0]).toEqual({
      name: "Fazenda Aurora",
      default_locale: "pt-BR",
      default_currency: "BRL",
      status: "active",
    });

    const membership = await db.adminPool.query(
      `SELECT role, status, valid_to FROM tenant_membership WHERE tenant_id = $1 AND user_id = $2`,
      [tenantAId, anaId],
    );
    expect(membership.rows).toEqual([
      { role: "tenant_owner", status: "active", valid_to: null },
    ]);

    const events = await db.adminPool.query(
      `SELECT event_type, aggregate_type, aggregate_id, aggregate_version
       FROM domain_event WHERE tenant_id = $1 ORDER BY event_id`,
      [tenantAId],
    );
    expect(events.rows).toEqual([
      {
        event_type: "identity.tenant_created.v1",
        aggregate_type: "tenant",
        aggregate_id: tenantAId,
        aggregate_version: 1,
      },
      {
        event_type: "identity.membership_activated.v1",
        aggregate_type: "user",
        aggregate_id: anaId,
        aggregate_version: 1,
      },
    ]);

    // One outbox row per event, same transaction (§31.1).
    const outbox = await db.adminPool.query(
      `SELECT count(*)::int AS n FROM outbox_message WHERE tenant_id = $1`,
      [tenantAId],
    );
    expect(outbox.rows[0].n).toBe(2);

    const audit = await db.adminPool.query(
      `SELECT action, outcome FROM audit_record WHERE tenant_id = $1`,
      [tenantAId],
    );
    expect(audit.rows).toContainEqual({
      action: "identity.tenant.created",
      outcome: "success",
    });
  });

  // -------------------------------------------------------------------------
  // Farms (tenant-scoped, manage_farms)
  // -------------------------------------------------------------------------

  it("lets the tenant_owner create a farm with event + outbox + audit", async () => {
    const farm = await service.createFarm(contextFor(tenantAId, anaId), {
      name: "Sede Brangus",
      areaHa: 1250.5,
    });
    _farmSedeId = farm.id;
    expect(farm.tenantId).toBe(tenantAId);
    expect(farm.timezone).toBe("America/Sao_Paulo");
    expect(farm.areaHa).toBe(1250.5);

    const event = await db.adminPool.query(
      `SELECT aggregate_version, farm_id, payload FROM domain_event
       WHERE tenant_id = $1 AND event_type = 'identity.farm_created.v1' AND aggregate_id = $2`,
      [tenantAId, farm.id],
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0].aggregate_version).toBe(1);
    expect(event.rows[0].farm_id).toBe(farm.id);
    expect(event.rows[0].payload.name).toBe("Sede Brangus");

    const outbox = await db.adminPool.query(
      `SELECT subject FROM outbox_message om
       JOIN domain_event de ON de.event_id = om.event_id
       WHERE de.aggregate_id = $1`,
      [farm.id],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].subject).not.toContain(tenantAId);

    const audit = await db.adminPool.query(
      `SELECT outcome FROM audit_record
       WHERE tenant_id = $1 AND action = 'identity.farm.created' AND resource_id = $2`,
      [tenantAId, farm.id],
    );
    expect(audit.rows).toEqual([{ outcome: "success" }]);
  });

  it("maps duplicate farm names within a tenant to ConflictError (23505)", async () => {
    await expect(
      service.createFarm(contextFor(tenantAId, anaId), { name: "Sede Brangus" }),
    ).rejects.toThrow(ConflictError);
  });

  // -------------------------------------------------------------------------
  // Invitations and membership lifecycle
  // -------------------------------------------------------------------------

  it("lets the tenant_owner invite a technician (invited user + membership + event)", async () => {
    const invited = await service.inviteUser(contextFor(tenantAId, anaId), {
      email: "carlos.pereira@example.com",
      displayName: "Carlos Pereira",
      role: "technician",
    });
    carlosId = invited.userId;
    expect(invited.status).toBe("invited");
    expect(invited.userStatus).toBe("invited");

    const user = await db.adminPool.query(
      `SELECT status FROM user_account WHERE id = $1`,
      [carlosId],
    );
    expect(user.rows[0].status).toBe("invited");

    const membership = await db.adminPool.query(
      `SELECT status, valid_to FROM tenant_membership
       WHERE tenant_id = $1 AND user_id = $2 AND role = 'technician'`,
      [tenantAId, carlosId],
    );
    expect(membership.rows).toEqual([{ status: "invited", valid_to: null }]);

    const event = await db.adminPool.query(
      `SELECT aggregate_version, payload FROM domain_event
       WHERE tenant_id = $1 AND event_type = 'identity.user_invited.v1' AND aggregate_id = $2`,
      [tenantAId, carlosId],
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0].payload.role).toBe("technician");
  });

  it("denies reads to a merely invited (not active) member", async () => {
    await expect(service.listFarms(contextFor(tenantAId, carlosId))).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("activates the membership (status active, event appended)", async () => {
    const membership = await service.activateMembership(contextFor(tenantAId, anaId), {
      userId: carlosId,
      role: "technician",
    });
    expect(membership.status).toBe("active");
    expect(membership.validTo).toBeNull();

    const user = await db.adminPool.query(
      `SELECT status FROM user_account WHERE id = $1`,
      [carlosId],
    );
    expect(user.rows[0].status).toBe("active");

    const event = await db.adminPool.query(
      `SELECT aggregate_version FROM domain_event
       WHERE tenant_id = $1 AND event_type = 'identity.membership_activated.v1' AND aggregate_id = $2`,
      [tenantAId, carlosId],
    );
    expect(event.rows).toEqual([{ aggregate_version: 2 }]); // invite v1, activate v2

    // The active technician can now read the tenant and its farms.
    const farms = await service.listFarms(contextFor(tenantAId, carlosId));
    expect(farms.map((f) => f.name)).toEqual(["Sede Brangus"]);
    const tenant = await service.getTenant(contextFor(tenantAId, carlosId));
    expect(tenant.name).toBe("Fazenda Aurora");
  });

  it("denies invite_users to a non-owner and audits the denial with a reason (§66, §68)", async () => {
    await expect(
      service.inviteUser(contextFor(tenantAId, carlosId), {
        email: "diana.rocha@example.com",
        displayName: "Diana Rocha",
        role: "veterinarian",
      }),
    ).rejects.toThrow(ForbiddenError);

    // Nothing was written for the denied attempt...
    const user = await db.adminPool.query(
      `SELECT 1 FROM user_account WHERE lower(email) = 'diana.rocha@example.com'`,
    );
    expect(user.rows).toHaveLength(0);

    // ...except the audit record carrying the decision reason.
    const audit = await db.adminPool.query(
      `SELECT detail FROM audit_record
       WHERE tenant_id = $1 AND action = 'identity.invite_users' AND outcome = 'denied' AND actor_id = $2`,
      [tenantAId, carlosId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].detail.reason).toMatch(/requires one of \[tenant_owner\]/);
    expect(audit.rows[0].detail.reason).toContain("technician");
  });

  it("rejects a duplicate open membership invite with ConflictError", async () => {
    await expect(
      service.inviteUser(contextFor(tenantAId, anaId), {
        email: "carlos.pereira@example.com",
        displayName: "Carlos Pereira",
        role: "technician",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("denies farm creation to an active technician (manage_farms role check)", async () => {
    await expect(
      service.createFarm(contextFor(tenantAId, carlosId), { name: "Retiro do Ipê" }),
    ).rejects.toThrow(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // Cross-tenant isolation (negative paths, §67)
  // -------------------------------------------------------------------------

  it("wrong TenantContext sees nothing: tenant B reads none of tenant A's data", async () => {
    const farms = await service.listFarms(contextFor(tenantBId, brunoId));
    expect(farms).toEqual([]);

    const tenant = await service.getTenant(contextFor(tenantBId, brunoId));
    expect(tenant.id).toBe(tenantBId);
    expect(tenant.name).toBe("Rancho Boa Vista");

    const members = await service.listMembers(contextFor(tenantBId, brunoId));
    expect(members.map((m) => m.email)).toEqual(["bruno.lima@example.com"]);
  });

  it("denies a forged context: tenant B's owner has no membership in tenant A", async () => {
    const forged = contextFor(tenantAId, brunoId);
    await expect(service.listFarms(forged)).rejects.toThrow(ForbiddenError);
    await expect(
      service.createFarm(forged, { name: "Fazenda Invasora" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      service.revokeMembership(forged, { userId: anaId, role: "tenant_owner" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("RLS blocks a cross-tenant write even if application code lies", async () => {
    const client = await db.appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantBId]);
      await expect(
        client.query(`INSERT INTO farm (tenant_id, name) VALUES ($1, 'Invasora')`, [
          tenantAId,
        ]),
      ).rejects.toThrow(/row-level security|violates/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("rejects inviting an email that exists on the platform outside this tenant", async () => {
    // Ana exists platform-wide but holds no membership in tenant B; under RLS
    // she is invisible there, and silent cross-tenant linking is forbidden.
    await expect(
      service.inviteUser(contextFor(tenantBId, brunoId), {
        email: "ana.souza@example.com",
        displayName: "Ana Souza",
        role: "auditor",
      }),
    ).rejects.toThrow(ConflictError);
  });

  // -------------------------------------------------------------------------
  // Revocation (JK-IAM-005: never delete)
  // -------------------------------------------------------------------------

  it("revokes the membership without deleting any row", async () => {
    const before = await db.adminPool.query(
      `SELECT count(*)::int AS n FROM tenant_membership WHERE tenant_id = $1 AND user_id = $2`,
      [tenantAId, carlosId],
    );

    const revoked = await service.revokeMembership(contextFor(tenantAId, anaId), {
      userId: carlosId,
      role: "technician",
    });
    expect(revoked.status).toBe("revoked");
    expect(revoked.validTo).not.toBeNull();

    const after = await db.adminPool.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE valid_to IS NOT NULL)::int AS closed
       FROM tenant_membership WHERE tenant_id = $1 AND user_id = $2`,
      [tenantAId, carlosId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n); // no row deleted
    expect(after.rows[0].closed).toBe(1);

    const event = await db.adminPool.query(
      `SELECT aggregate_version FROM domain_event
       WHERE tenant_id = $1 AND event_type = 'identity.membership_revoked.v1' AND aggregate_id = $2`,
      [tenantAId, carlosId],
    );
    expect(event.rows).toEqual([{ aggregate_version: 3 }]);
  });

  it("denies reads after revocation, but history remains listable by the owner", async () => {
    await expect(service.listFarms(contextFor(tenantAId, carlosId))).rejects.toThrow(
      ForbiddenError,
    );

    const members = await service.listMembers(contextFor(tenantAId, anaId));
    const carlos = members.find((m) => m.userId === carlosId);
    expect(carlos?.status).toBe("revoked");
    expect(carlos?.validTo).not.toBeNull(); // authorship preserved (JK-IAM-005)
  });

  it("maps membership changes for unknown users to NotFoundError", async () => {
    await expect(
      service.activateMembership(contextFor(tenantAId, anaId), {
        userId: newUuid(),
        role: "technician",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      service.revokeMembership(contextFor(tenantAId, anaId), {
        userId: carlosId,
        role: "technician", // already closed
      }),
    ).rejects.toThrow(NotFoundError);
  });

  // -------------------------------------------------------------------------
  // Ledger integrity
  // -------------------------------------------------------------------------

  it("wrote exactly one outbox row per domain event, and only canonical types", async () => {
    const integrity = await db.adminPool.query(
      `SELECT
         (SELECT count(*)::int FROM domain_event) AS events,
         (SELECT count(*)::int FROM outbox_message) AS outbox,
         (SELECT count(*)::int FROM domain_event de
            LEFT JOIN outbox_message om ON om.event_id = de.event_id
            WHERE om.event_id IS NULL) AS orphans`,
    );
    expect(integrity.rows[0].events).toBeGreaterThan(0);
    expect(integrity.rows[0].outbox).toBe(integrity.rows[0].events);
    expect(integrity.rows[0].orphans).toBe(0);

    const types = await db.adminPool.query(
      `SELECT DISTINCT event_type FROM domain_event ORDER BY event_type`,
    );
    expect(types.rows.map((r) => r.event_type)).toEqual([
      "identity.farm_created.v1",
      "identity.membership_activated.v1",
      "identity.membership_revoked.v1",
      "identity.tenant_created.v1",
      "identity.user_invited.v1",
    ]);
  });
});

describe.skipIf(available)("IdentityService suite (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
