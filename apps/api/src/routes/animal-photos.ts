import { createHash } from "node:crypto";
import { PHOTO_CONTENT_TYPES, type AnimalRegistryService } from "@jk/animal-registry";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  MissingHeaderError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "../errors.js";
import { buildTenantContext } from "../request-context.js";
import type { ObjectStorage } from "../storage.js";

/**
 * Animal photo gallery REST surface (JK-ANI photo gallery): upload a dated
 * photo, list the gallery, download a photo's bytes, and soft-remove one.
 * This package owns the multipart→storage transfer; animal-registry only
 * ever sees the resulting metadata (storageKey/checksum/byteSize).
 */

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

export function registerAnimalPhotoRoutes(
  app: FastifyInstance,
  service: AnimalRegistryService,
  storage: ObjectStorage,
): void {
  const ctx = (request: FastifyRequest) =>
    buildTenantContext(request.principal, tenantHeader(request), request.correlationId);

  app.post(
    "/api/v1/animals/:animalId/photos",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const key = idempotencyKey(request);
      const { animalId } = request.params as { animalId: string };
      const context = ctx(request);

      const upload = await request.file();
      if (!upload) {
        throw new UnsupportedMediaTypeError("A multipart file field is required");
      }
      if (!PHOTO_CONTENT_TYPES.includes(upload.mimetype as never)) {
        throw new UnsupportedMediaTypeError(
          `Unsupported content type '${upload.mimetype}'; expected one of ${PHOTO_CONTENT_TYPES.join(", ")}`,
        );
      }
      const body = await upload.toBuffer();
      if (upload.file.truncated) {
        throw new PayloadTooLargeError("Photo exceeds the maximum upload size");
      }

      const fields = upload.fields as Record<string, { value?: unknown } | undefined>;
      const takenAt = fields.takenAt?.value as string | undefined;
      const caption = fields.caption?.value as string | undefined;
      if (!takenAt) {
        throw new MissingHeaderError("The 'takenAt' form field is required");
      }

      const checksumSha256 = createHash("sha256").update(body).digest("hex");
      const extension = CONTENT_TYPE_EXTENSION[upload.mimetype] ?? "bin";
      const storageKey = `${context.tenantId}/${animalId}/${takenAt}-${checksumSha256.slice(0, 16)}.${extension}`;

      await storage.putObject(storageKey, body, upload.mimetype);

      const photo = await service.addPhotoMetadata(context, {
        animalId,
        takenAt,
        caption: caption || undefined,
        storageKey,
        contentType: upload.mimetype as never,
        byteSize: body.length,
        checksumSha256,
        idempotencyKey: `photo-add:${key}`,
      });
      reply.status(201);
      return photo;
    },
  );

  app.get("/api/v1/animals/:animalId/photos", async (request: FastifyRequest) => {
    const { animalId } = request.params as { animalId: string };
    const photos = await service.listPhotos(ctx(request), animalId);
    return { items: photos };
  });

  app.get(
    "/api/v1/animals/:animalId/photos/:photoId/download",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { animalId, photoId } = request.params as {
        animalId: string;
        photoId: string;
      };
      const photo = await service.getPhoto(ctx(request), animalId, photoId);
      const object = await storage.getObject(photo.storageKey);
      reply.type(object.contentType ?? photo.contentType);
      reply.header("x-content-checksum-sha256", photo.checksumSha256);
      return reply.send(object.stream);
    },
  );

  app.delete(
    "/api/v1/animals/:animalId/photos/:photoId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { animalId, photoId } = request.params as {
        animalId: string;
        photoId: string;
      };
      const body = (request.body ?? {}) as Record<string, unknown>;
      await service.removePhoto(ctx(request), {
        animalId,
        photoId,
        reason: body.reason as string | undefined,
        idempotencyKey: `photo-remove:${idempotencyKey(request)}`,
      });
      reply.status(204);
      return reply.send();
    },
  );
}
