import type { IdentityService } from "@jk/identity-tenancy";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ForbiddenError } from "@jk/identity-tenancy";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/**
 * Identity and Tenancy REST surface (§45-§47), matching
 * contracts/openapi/jk-platform.yaml. All commands require an Idempotency-Key
 * header (§46). Tenant selection comes from x-tenant-id and is authorized by
 * the application policy (a client cannot serve itself another tenant).
 */

function requireIdempotencyKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  const value = Array.isArray(key) ? key[0] : key;
  if (!value || value.length < 1) {
    throw new MissingHeaderError("Idempotency-Key header is required for this command");
  }
  return value;
}

function tenantIdHeader(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-tenant-id"];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function registerIdentityRoutes(
  app: FastifyInstance,
  service: IdentityService,
): void {
  // --- Tenants -------------------------------------------------------------

  app.post("/api/v1/tenants", async (request: FastifyRequest, reply: FastifyReply) => {
    const idempotencyKey = requireIdempotencyKey(request);
    if (!request.principal.isPlatformAdmin) {
      throw new ForbiddenError(
        "Creating a tenant requires platform administrator rights",
      );
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await service.createTenant(
      {
        name: body.name as string,
        defaultLocale: body.defaultLocale as string | undefined,
        defaultCurrency: body.defaultCurrency as string | undefined,
        owner: body.owner as { email: string; displayName: string } | undefined,
        correlationId: request.correlationId,
        idempotencyKey: `tenant-create:${idempotencyKey}`,
      },
      {
        type: "user",
        id: request.principal.userId,
        display: request.principal.displayName,
      },
    );
    reply.status(201);
    return { tenant: result.tenant, ownerUserId: result.ownerUserId };
  });

  app.get("/api/v1/tenants/current", async (request: FastifyRequest) => {
    const context = buildTenantContext(
      request.principal,
      tenantIdHeader(request),
      request.correlationId,
    );
    return service.getTenant(context);
  });

  app.patch("/api/v1/tenants/current", async (request: FastifyRequest) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const context = buildTenantContext(
      request.principal,
      tenantIdHeader(request),
      request.correlationId,
    );
    const body = (request.body ?? {}) as Record<string, unknown>;
    return service.updateTenant(context, {
      defaultLocale: body.defaultLocale as string | undefined,
      defaultCurrency: body.defaultCurrency as string | undefined,
      idempotencyKey: `tenant-settings:${idempotencyKey}`,
    });
  });

  // --- Farms ---------------------------------------------------------------

  app.post("/api/v1/farms", async (request: FastifyRequest, reply: FastifyReply) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const context = buildTenantContext(
      request.principal,
      tenantIdHeader(request),
      request.correlationId,
    );
    const body = (request.body ?? {}) as Record<string, unknown>;
    const farm = await service.createFarm(context, {
      name: body.name as string,
      timezone: body.timezone as string | undefined,
      areaHa: body.areaHa as number | undefined,
      idempotencyKey: `farm-create:${idempotencyKey}`,
    });
    reply.status(201);
    return farm;
  });

  app.get("/api/v1/farms", async (request: FastifyRequest) => {
    const context = buildTenantContext(
      request.principal,
      tenantIdHeader(request),
      request.correlationId,
    );
    const farms = await service.listFarms(context);
    return { items: farms };
  });

  // --- Users / invitations -------------------------------------------------

  app.post(
    "/api/v1/users/invitations",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const idempotencyKey = requireIdempotencyKey(request);
      const context = buildTenantContext(
        request.principal,
        tenantIdHeader(request),
        request.correlationId,
      );
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await service.inviteUser(context, {
        email: body.email as string,
        displayName: body.displayName as string,
        role: body.role as never,
        idempotencyKey: `user-invite:${idempotencyKey}`,
      });
      reply.status(201);
      return result;
    },
  );

  app.get("/api/v1/users", async (request: FastifyRequest) => {
    const context = buildTenantContext(
      request.principal,
      tenantIdHeader(request),
      request.correlationId,
    );
    const members = await service.listMembers(context);
    return { items: members };
  });
}
