import type { ConnectorRegistryService, WebhookService } from "@jk/automation-integration";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MissingHeaderError } from "../errors.js";
import { buildTenantContext } from "../request-context.js";

/** Webhooks & connectors REST surface (§33, §51). */
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

export function registerWebhookRoutes(
  app: FastifyInstance,
  webhooks: WebhookService,
  connectors: ConnectorRegistryService,
): void {
  const ctx = (r: FastifyRequest) => buildTenantContext(r.principal, tenant(r), r.correlationId);

  // -- Webhook subscriptions --
  app.post("/api/v1/webhooks/subscriptions", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const sub = await webhooks.subscribe(ctx(r), { ...(r.body as object), idempotencyKey: `whsub:${key}` } as never);
    reply.status(201);
    return sub;
  });

  app.get("/api/v1/webhooks/subscriptions", async (r: FastifyRequest) => {
    return { items: await webhooks.listSubscriptions(ctx(r)) };
  });

  app.get("/api/v1/webhooks/subscriptions/:id", async (r: FastifyRequest) => {
    const { id } = r.params as { id: string };
    return webhooks.getSubscription(ctx(r), id);
  });

  app.post("/api/v1/webhooks/subscriptions/:id/rotate-secret", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    const { id } = r.params as { id: string };
    reply.status(200);
    return webhooks.rotateSecret(ctx(r), id);
  });

  app.delete("/api/v1/webhooks/subscriptions/:id", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    const { id } = r.params as { id: string };
    await webhooks.deactivate(ctx(r), id);
    reply.status(204);
  });

  // -- Deliveries --
  app.get("/api/v1/webhooks/deliveries", async (r: FastifyRequest) => {
    const q = r.query as { status?: string; subscriptionId?: string };
    return { items: await webhooks.listDeliveries(ctx(r), q) };
  });

  app.post("/api/v1/webhooks/deliveries/:id/replay", async (r: FastifyRequest, reply: FastifyReply) => {
    idem(r);
    const { id } = r.params as { id: string };
    reply.status(200);
    return webhooks.replayDelivery(ctx(r), id);
  });

  // -- Connector registrations (§33) --
  app.post("/api/v1/connectors", async (r: FastifyRequest, reply: FastifyReply) => {
    const key = idem(r);
    const reg = await connectors.registerConnector(ctx(r), {
      ...(r.body as object),
      idempotencyKey: `connector:${key}`,
    } as never);
    reply.status(201);
    return reg;
  });

  app.get("/api/v1/connectors", async (r: FastifyRequest) => {
    return { items: await connectors.listConnectors(ctx(r)) };
  });

  app.get("/api/v1/connectors/:id", async (r: FastifyRequest) => {
    const { id } = r.params as { id: string };
    return connectors.getConnector(ctx(r), id);
  });
}
