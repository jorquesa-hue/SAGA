import { newUuid } from "@jk/domain-kernel";
import { silentLogger } from "@jk/observability";
import { createTestDatabase, databaseAvailable, type TestDatabase } from "@jk/testkit";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { ApiConfig } from "../../src/config.js";
import { createInMemoryObjectStorage } from "../../src/storage.js";

const available = databaseAvailable();

const config: ApiConfig = {
  APP_ENV: "local",
  PORT: 0,
  HOST: "127.0.0.1",
  DATABASE_URL: "direct-pools",
  APP_DATABASE_URL: "direct-pools",
  LOG_LEVEL: "error",
  STORAGE_ENDPOINT: "http://localhost:9000",
  STORAGE_REGION: "us-east-1",
  STORAGE_ACCESS_KEY_ID: "unused-in-test",
  STORAGE_SECRET_ACCESS_KEY: "unused-in-test",
  STORAGE_BUCKET: "unused-in-test",
  STORAGE_FORCE_PATH_STYLE: true,
  CORS_ORIGINS: "",
  AI_ENABLED: false,
};

function multipartUpload(fields: Record<string, string>, file: Buffer, contentType: string) {
  const boundary = `jkTestBoundary${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.bin"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
  );
  parts.push(file);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.skipIf(!available)("Animal photo gallery API (integration)", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let tenantId: string;
  let ownerId: string;
  let farmId: string;
  let animalId: string;

  const owner = () => ({ "x-dev-user-id": ownerId, "x-tenant-id": tenantId });
  const cmd = () => ({ ...owner(), "idempotency-key": newUuid() });

  beforeAll(async () => {
    db = await createTestDatabase("jk_api_photos");
    app = await buildApp({
      config,
      pools: { systemPool: db.adminPool, appPool: db.appPool, close: async () => {} },
      logger: silentLogger,
      objectStorage: createInMemoryObjectStorage(),
    });
    await app.ready();

    const tenant = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: {
        "x-dev-user-id": newUuid(),
        "x-dev-platform-admin": "true",
        "idempotency-key": newUuid(),
      },
      payload: {
        name: "Fazenda Fotos API",
        owner: { email: "owner@example.com", displayName: "Owner" },
      },
    });
    tenantId = tenant.json().tenant.id;
    ownerId = tenant.json().ownerUserId;
    const farm = await app.inject({
      method: "POST",
      url: "/api/v1/farms",
      headers: cmd(),
      payload: { name: "Sede", areaHa: 100 },
    });
    farmId = farm.json().id;

    const animal = await app.inject({
      method: "POST",
      url: "/api/v1/animals",
      headers: cmd(),
      payload: { farmId, visualId: "OV-PHOTO-1", sex: "female", speciesCode: "OVINE" },
    });
    animalId = animal.json().id;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  });

  it("uploads a dated photo (201), lists it in the gallery, and downloads the exact bytes back", async () => {
    const fileBytes = Buffer.from("synthetic-jpeg-bytes-for-testing");
    const { body, contentType } = multipartUpload(
      { takenAt: "2026-01-15", caption: "Lamb, first weeks" },
      fileBytes,
      "image/jpeg",
    );

    const upload = await app.inject({
      method: "POST",
      url: `/api/v1/animals/${animalId}/photos`,
      headers: { ...cmd(), "content-type": contentType },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);
    const photo = upload.json();
    expect(photo.takenAt).toBe("2026-01-15");
    expect(photo.byteSize).toBe(fileBytes.length);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/animals/${animalId}/photos`,
      headers: owner(),
    });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].id).toBe(photo.id);

    const download = await app.inject({
      method: "GET",
      url: `/api/v1/animals/${animalId}/photos/${photo.id}/download`,
      headers: owner(),
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.equals(fileBytes)).toBe(true);
    expect(download.headers["x-content-checksum-sha256"]).toBe(photo.checksumSha256);
  });

  it("rejects an unsupported content type (415)", async () => {
    const { body, contentType } = multipartUpload(
      { takenAt: "2026-01-15" },
      Buffer.from("not-an-image"),
      "application/pdf",
    );
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/animals/${animalId}/photos`,
      headers: { ...cmd(), "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(415);
  });

  it("rejects an upload missing the takenAt field (400)", async () => {
    const { body, contentType } = multipartUpload({}, Buffer.from("bytes"), "image/png");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/animals/${animalId}/photos`,
      headers: { ...cmd(), "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("soft-removes a photo: gone from the gallery and no longer downloadable", async () => {
    const fileBytes = Buffer.from("second-photo-bytes");
    const { body, contentType } = multipartUpload(
      { takenAt: "2026-02-01" },
      fileBytes,
      "image/webp",
    );
    const upload = await app.inject({
      method: "POST",
      url: `/api/v1/animals/${animalId}/photos`,
      headers: { ...cmd(), "content-type": contentType },
      payload: body,
    });
    const photoId = upload.json().id;

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/animals/${animalId}/photos/${photoId}`,
      headers: cmd(),
      payload: { reason: "wrong animal" },
    });
    expect(remove.statusCode).toBe(204);

    const download = await app.inject({
      method: "GET",
      url: `/api/v1/animals/${animalId}/photos/${photoId}/download`,
      headers: owner(),
    });
    expect(download.statusCode).toBe(404);
  });
});

describe.skipIf(available)("Animal photo gallery API (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
