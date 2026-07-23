import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlertService,
  FarmIntelligenceService,
  RecommendationService,
  ReportService,
} from "@jk/analytics-intelligence";
import { AnimalRegistryService } from "@jk/animal-registry";
import { AssetsMaintenanceService } from "@jk/assets-maintenance";
import { ConnectorRegistryService, WebhookService } from "@jk/automation-integration";
import { FinanceService } from "@jk/finance-commerce";
import { LandGrazingService } from "@jk/land-grazing";
import { InventoryService } from "@jk/nutrition-inventory";
import { HealthService } from "@jk/health-laboratory";
import { LotsService, WeighingService } from "@jk/herd-operations";
import { IdentityService } from "@jk/identity-tenancy";
import { GeneticsService, ReproductionGeneticsService } from "@jk/reproduction-genetics";
import {
  CORRELATION_HEADER,
  createLogger,
  resolveCorrelationId,
  type Logger,
} from "@jk/observability";
import Fastify, { type FastifyInstance } from "fastify";
import type { ApiConfig } from "./config.js";
import { createAuthenticator, type AuthenticatedPrincipal, type Authenticator } from "./auth.js";
import { RouteNotFoundError, UnauthorizedError } from "./errors.js";
import type { DatabasePools } from "./pools.js";
import { PROBLEM_CONTENT_TYPE, toProblem } from "./problem.js";
import { registerAnimalRoutes } from "./routes/animals.js";
import { registerHealthRoutes as registerHealthProbeRoutes } from "./routes/health.js";
import { registerHealthRoutes } from "./routes/health.routes.js";
import { registerHerdRoutes } from "./routes/herd.js";
import { registerIdentityRoutes } from "./routes/identity.js";
import { registerAnalyticsRoutes } from "./routes/analytics.routes.js";
import { registerLotRoutes } from "./routes/lots.routes.js";
import { registerPhase3Routes } from "./routes/phase3.routes.js";
import { registerPhase4Routes } from "./routes/phase4.routes.js";
import { registerAiRoutes } from "./routes/ai.routes.js";
import { registerWebhookRoutes } from "./routes/webhooks.routes.js";
import { registerReproductionRoutes } from "./routes/reproduction.routes.js";

declare module "fastify" {
  interface FastifyRequest {
    correlationId: string;
    principal: AuthenticatedPrincipal;
  }
}

export interface AppDependencies {
  config: ApiConfig;
  pools: DatabasePools;
  logger?: Logger;
  authenticator?: Authenticator;
  identityService?: IdentityService;
}

const __dir = dirname(fileURLToPath(import.meta.url));

/**
 * Build the Fastify application: correlation-id propagation, authentication
 * on /api/v1 routes, structured request logging, RFC 9457 error mapping, and
 * the identity/health routes. Pure assembly — no listening.
 */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const logger =
    deps.logger ?? createLogger({ service: "jk-api", environment: deps.config.APP_ENV, level: deps.config.LOG_LEVEL });
  const authenticator = deps.authenticator ?? createAuthenticator(deps.config);
  const identityService =
    deps.identityService ??
    new IdentityService({
      systemPool: deps.pools.systemPool,
      appPool: deps.pools.appPool,
      environment: deps.config.APP_ENV,
    });
  const animalRegistry = new AnimalRegistryService({
    appPool: deps.pools.appPool,
    environment: deps.config.APP_ENV,
  });
  const weighing = new WeighingService({
    appPool: deps.pools.appPool,
    environment: deps.config.APP_ENV,
  });
  const lotsService = new LotsService({
    appPool: deps.pools.appPool,
    environment: deps.config.APP_ENV,
  });
  const healthService = new HealthService({
    appPool: deps.pools.appPool,
    environment: deps.config.APP_ENV,
  });
  const reproductionService = new ReproductionGeneticsService({
    appPool: deps.pools.appPool,
    environment: deps.config.APP_ENV,
  });
  const alertService = new AlertService({ appPool: deps.pools.appPool });
  const reportService = new ReportService({ appPool: deps.pools.appPool });
  const landService = new LandGrazingService({ appPool: deps.pools.appPool, environment: deps.config.APP_ENV });
  const inventoryService = new InventoryService({ appPool: deps.pools.appPool, environment: deps.config.APP_ENV });
  const assetsService = new AssetsMaintenanceService({ appPool: deps.pools.appPool, environment: deps.config.APP_ENV });
  const financeService = new FinanceService({ appPool: deps.pools.appPool, environment: deps.config.APP_ENV });
  const geneticsService = new GeneticsService({ appPool: deps.pools.appPool, environment: deps.config.APP_ENV });
  const farmIntelligenceService = new FarmIntelligenceService({ appPool: deps.pools.appPool });
  const recommendationService = new RecommendationService({
    appPool: deps.pools.appPool,
    environment: deps.config.APP_ENV,
    aiEnabled: deps.config.AI_ENABLED,
  });
  const webhookService = new WebhookService({ appPool: deps.pools.appPool, environment: deps.config.APP_ENV });
  const connectorService = new ConnectorRegistryService({ appPool: deps.pools.appPool, environment: deps.config.APP_ENV });

  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });

  // Correlation id on every request; echoed back for client-side tracing.
  app.addHook("onRequest", async (request, reply) => {
    request.correlationId = resolveCorrelationId(request.headers[CORRELATION_HEADER]);
    reply.header(CORRELATION_HEADER, request.correlationId);
  });

  // Authentication for the business API only; health probes stay open.
  app.addHook("preHandler", async (request) => {
    if (!request.url.startsWith("/api/v1")) return;
    request.principal = await authenticator.authenticate(request.headers);
  });

  // Structured access log — never logs headers, tokens, or bodies.
  app.addHook("onResponse", async (request, reply) => {
    logger.info(
      {
        method: request.method,
        path: request.routeOptions?.url ?? request.url,
        status: reply.statusCode,
        latencyMs: Math.round(reply.elapsedTime),
        correlationId: request.correlationId,
        actorId: request.principal?.userId,
        authMode: authenticator.mode,
      },
      "request",
    );
  });

  // Unified error handler → Problem Details.
  app.setErrorHandler((error, request, reply) => {
    const problem = toProblem(error, request.correlationId ?? "unknown");
    if (problem.status >= 500) {
      logger.error(
        { err: error, correlationId: problem.correlationId, path: request.url },
        "unhandled error",
      );
    }
    reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
  });

  app.setNotFoundHandler((request, reply) => {
    const problem = toProblem(
      new RouteNotFoundError(`No route for ${request.method} ${request.url}`),
      request.correlationId ?? "unknown",
    );
    reply.status(404).type(PROBLEM_CONTENT_TYPE).send(problem);
  });

  // Serve the AUTHORED OpenAPI contract (not a divergent generated one).
  const openapiPath = join(__dir, "../../../contracts/openapi/jk-platform.yaml");
  app.get("/api/docs/openapi.yaml", async (_request, reply) => {
    try {
      const yaml = await readFile(openapiPath, "utf8");
      reply.type("application/yaml").send(yaml);
    } catch {
      reply.status(404).type(PROBLEM_CONTENT_TYPE).send(
        toProblem(new RouteNotFoundError("OpenAPI document not found"), "n/a"),
      );
    }
  });

  registerHealthProbeRoutes(app, deps.pools);
  registerIdentityRoutes(app, identityService);
  registerAnimalRoutes(app, animalRegistry);
  registerHerdRoutes(app, weighing);
  registerLotRoutes(app, lotsService);
  registerHealthRoutes(app, healthService);
  registerReproductionRoutes(app, reproductionService);
  registerAnalyticsRoutes(app, alertService, reportService);
  registerPhase3Routes(app, landService, inventoryService, assetsService);
  registerPhase4Routes(app, financeService, geneticsService, farmIntelligenceService);
  registerAiRoutes(app, recommendationService);
  registerWebhookRoutes(app, webhookService, connectorService);

  // Surface a typed unauthorized when auth decoration is somehow missing.
  app.decorateRequest("principal", null as unknown as AuthenticatedPrincipal);
  void UnauthorizedError;

  return app;
}
