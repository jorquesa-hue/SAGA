import type { AnimalRegistryService } from "@jk/animal-registry";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/**
 * Animal Registry REST surface (§18, §47): register, read, list, timeline, and
 * identifier assignment/replacement. Commands require an Idempotency-Key.
 */

function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  const value = Array.isArray(key) ? key[0] : key;
  if (!value)
    throw new MissingHeaderError("Idempotency-Key header is required for this command");
  return value;
}

function tenantHeader(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-tenant-id"];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function registerAnimalRoutes(
  app: FastifyInstance,
  service: AnimalRegistryService,
): void {
  const ctx = (request: FastifyRequest) =>
    buildTenantContext(request.principal, tenantHeader(request), request.correlationId);

  app.post("/api/v1/animals", async (request: FastifyRequest, reply: FastifyReply) => {
    const key = idempotencyKey(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const animal = await service.registerAnimal(ctx(request), {
      farmId: body.farmId as string,
      visualId: body.visualId as string,
      sex: body.sex as never,
      breedCode: body.breedCode as string | undefined,
      speciesCode: body.speciesCode as never,
      birthDate: body.birthDate as string | undefined,
      birthDatePrecision: body.birthDatePrecision as never,
      rfid: body.rfid as string | undefined,
      idempotencyKey: `animal-register:${key}`,
    });
    reply.status(201);
    return animal;
  });

  app.get("/api/v1/animals", async (request: FastifyRequest) => {
    const farmId = (request.query as { farmId?: string })?.farmId;
    const animals = await service.listAnimals(ctx(request), farmId);
    return { items: animals };
  });

  app.get("/api/v1/animals/:animalId", async (request: FastifyRequest) => {
    const { animalId } = request.params as { animalId: string };
    return service.getAnimal(ctx(request), animalId);
  });

  app.get("/api/v1/animals/:animalId/timeline", async (request: FastifyRequest) => {
    const { animalId } = request.params as { animalId: string };
    const query = request.query as { limit?: string; types?: string };
    const entries = await service.getTimeline(ctx(request), animalId, {
      limit: query.limit ? Number(query.limit) : undefined,
      types: query.types ? query.types.split(",") : undefined,
    });
    return { items: entries };
  });

  app.post(
    "/api/v1/animals/:animalId/identifiers",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const key = idempotencyKey(request);
      const { animalId } = request.params as { animalId: string };
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (body.replace === true) {
        const identifier = await service.replaceIdentifier(ctx(request), {
          animalId,
          identifierType: body.identifierType as never,
          newValue: body.identifierValue as string,
          reason: body.reason as string | undefined,
          idempotencyKey: `identifier-replace:${key}`,
        });
        reply.status(201);
        return identifier;
      }
      const identifier = await service.assignIdentifier(ctx(request), {
        animalId,
        identifierType: body.identifierType as never,
        identifierValue: body.identifierValue as string,
        idempotencyKey: `identifier-assign:${key}`,
      });
      reply.status(201);
      return identifier;
    },
  );
}
