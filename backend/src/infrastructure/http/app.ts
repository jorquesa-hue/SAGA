import express, { type Request, type Response, type NextFunction } from "express";
import { z, ZodError } from "zod";
import { SagaService } from "../../application/useCases.js";
import { DomainError, NotFoundError } from "../../domain/shared/errors.js";

/**
 * HTTP adapter. Validates input with Zod, delegates to use cases, and maps
 * domain errors to HTTP status codes. No business logic lives here.
 *
 * For this foundation slice, organizationId is taken from the `x-org-id`
 * header (a single default is used if absent). Real authentication &
 * authorisation arrive in Phase 1.
 */

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

function orgId(req: Request): string {
  const header = req.header("x-org-id");
  return header && header.trim() ? header.trim() : DEFAULT_ORG;
}

const farmSchema = z.object({
  name: z.string().min(1),
  totalAreaHa: z.number().nonnegative(),
  municipality: z.string().optional(),
  province: z.string().optional(),
});

const parcelSchema = z.object({
  farmId: z.string().min(1),
  code: z.string().min(1),
  areaHa: z.number().positive(),
  sigpacRef: z.string().optional(),
  irrigation: z.enum(["rainfed", "irrigated"]).optional(),
});

const cropCycleSchema = z.object({
  parcelId: z.string().min(1),
  crop: z.string().min(1),
  variety: z.string().optional(),
  cultivatedAreaHa: z.number().positive(),
  plannedSowing: z.string().optional(),
  plannedHarvest: z.string().optional(),
});

const advanceSchema = z.object({
  status: z.enum(["planned", "active", "harvested", "closed"]),
});

const partnerSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["customer", "supplier", "both"]),
  taxId: z.string().optional(),
  email: z.string().optional(),
});

export function createApp(service: SagaService) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "saga-backend", version: "0.1.0" });
  });

  const api = express.Router();

  // Farms
  api.post("/farms", async (req, res, next) => {
    try {
      const body = farmSchema.parse(req.body);
      const farm = await service.createFarm({ organizationId: orgId(req), ...body });
      res.status(201).json(farm.toJSON());
    } catch (e) {
      next(e);
    }
  });

  api.get("/farms", async (req, res, next) => {
    try {
      const farms = await service.listFarms(orgId(req));
      res.json(farms.map((f) => f.toJSON()));
    } catch (e) {
      next(e);
    }
  });

  // Parcels
  api.post("/parcels", async (req, res, next) => {
    try {
      const body = parcelSchema.parse(req.body);
      const parcel = await service.registerParcel({ organizationId: orgId(req), ...body });
      res.status(201).json(parcel.toJSON());
    } catch (e) {
      next(e);
    }
  });

  api.get("/farms/:farmId/parcels", async (req, res, next) => {
    try {
      const parcels = await service.listParcels(orgId(req), req.params.farmId);
      res.json(parcels.map((p) => p.toJSON()));
    } catch (e) {
      next(e);
    }
  });

  // Crop cycles
  api.post("/crop-cycles", async (req, res, next) => {
    try {
      const body = cropCycleSchema.parse(req.body);
      const cycle = await service.openCropCycle({ organizationId: orgId(req), ...body });
      res.status(201).json(cycle.toJSON());
    } catch (e) {
      next(e);
    }
  });

  api.post("/crop-cycles/:id/advance", async (req, res, next) => {
    try {
      const { status } = advanceSchema.parse(req.body);
      const cycle = await service.advanceCropCycle(orgId(req), req.params.id, status);
      res.json(cycle.toJSON());
    } catch (e) {
      next(e);
    }
  });

  api.get("/parcels/:parcelId/crop-cycles", async (req, res, next) => {
    try {
      const cycles = await service.listCropCycles(orgId(req), req.params.parcelId);
      res.json(cycles.map((c) => c.toJSON()));
    } catch (e) {
      next(e);
    }
  });

  // Partners
  api.post("/partners", async (req, res, next) => {
    try {
      const body = partnerSchema.parse(req.body);
      const partner = await service.createPartner({ organizationId: orgId(req), ...body });
      res.status(201).json(partner.toJSON());
    } catch (e) {
      next(e);
    }
  });

  api.get("/partners", async (req, res, next) => {
    try {
      const partners = await service.listPartners(orgId(req));
      res.json(partners.map((p) => p.toJSON()));
    } catch (e) {
      next(e);
    }
  });

  app.use("/api", api);

  // Error mapping
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "ValidationError", details: err.issues });
    }
    if (err instanceof DomainError) {
      return res.status(422).json({ error: "DomainError", message: err.message });
    }
    if (err instanceof NotFoundError) {
      return res.status(404).json({ error: "NotFound", message: err.message });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "InternalError" });
  });

  return app;
}
