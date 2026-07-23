import type { AnimalRegistryService } from "@jk/animal-registry";
import type { ImportService, RowExecutor } from "@jk/data-import";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/**
 * Staged import REST surface (§27). The execute stage's RowExecutor is wired
 * here, at the composition root, to the AnimalRegistry service — so the import
 * module never writes another module's tables directly.
 */
function idem(request: FastifyRequest): string {
  const v = request.headers["idempotency-key"];
  const key = Array.isArray(v) ? v[0] : v;
  if (!key) throw new MissingHeaderError("Idempotency-Key header is required for this command");
  return key;
}
function tenant(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-tenant-id"];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function registerImportRoutes(app: FastifyInstance, imports: ImportService, animals: AnimalRegistryService): void {
  const ctx = (r: FastifyRequest) => buildTenantContext(r.principal, tenant(r), r.correlationId);

  app.post("/api/v1/imports", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const job = await imports.upload(ctx(r), { ...(r.body as object), idempotencyKey: `import:${key}` } as never);
    reply.status(201);
    return job;
  });

  app.get("/api/v1/imports", async (r: FastifyRequest) => ({ items: await imports.listJobs(ctx(r)) }));
  app.get("/api/v1/imports/:id", async (r: FastifyRequest) => imports.getJob(ctx(r), (r.params as { id: string }).id));

  app.post("/api/v1/imports/:id/parse", async (r: FastifyRequest) => {
    idem(r);
    return imports.parse(ctx(r), (r.params as { id: string }).id);
  });
  app.post("/api/v1/imports/:id/map", async (r: FastifyRequest) => {
    idem(r);
    return imports.map(ctx(r), (r.params as { id: string }).id, r.body as never);
  });
  app.post("/api/v1/imports/:id/validate", async (r: FastifyRequest) => {
    idem(r);
    return imports.validate(ctx(r), (r.params as { id: string }).id);
  });
  app.get("/api/v1/imports/:id/preview", async (r: FastifyRequest) => imports.preview(ctx(r), (r.params as { id: string }).id));

  app.post("/api/v1/imports/:id/execute", async (r: FastifyRequest) => {
    idem(r);
    const context = ctx(r);
    const { id } = r.params as { id: string };
    // Execute stage: create each valid animal via the owning service.
    const executor: RowExecutor = async (row, scope) => {
      try {
        const animal = await animals.registerAnimal(context, {
          farmId: scope.farmId ?? "",
          visualId: row.visualId,
          sex: row.sex,
          breedCode: row.breedCode,
          birthDate: row.birthDate,
          rfid: row.rfid,
          idempotencyKey: `import-${id}-${row.visualId}`,
        });
        return { status: "created", serverId: animal.id };
      } catch (e) {
        const code = (e as { code?: string }).code;
        return { status: "failed", error: code ?? (e as Error).message };
      }
    };
    return imports.execute(context, id, executor);
  });

  app.post("/api/v1/imports/:id/reconcile", async (r: FastifyRequest) => {
    idem(r);
    return imports.reconcile(ctx(r), (r.params as { id: string }).id);
  });
}
