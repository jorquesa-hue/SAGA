import type { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ApiConfig } from "./config.js";

/**
 * Object storage port for animal photo bytes (JK-ANI photo gallery). The
 * animal-registry package owns photo metadata only; this is the one place
 * that touches raw bytes, kept behind a narrow interface so it can be backed
 * by a real S3-compatible service (MinIO in dev/prod) or an in-memory fake in
 * tests that cannot reach a live object store.
 */
export interface ObjectStorage {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<{ stream: Readable; contentType: string | null }>;
}

export function createS3ObjectStorage(config: ApiConfig): ObjectStorage {
  const client = new S3Client({
    endpoint: config.STORAGE_ENDPOINT,
    region: config.STORAGE_REGION,
    forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
    },
  });
  const bucket = config.STORAGE_BUCKET;

  return {
    async putObject(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async getObject(key) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        stream: result.Body as Readable,
        contentType: result.ContentType ?? null,
      };
    },
  };
}

/**
 * In-memory object storage for tests and any environment without a reachable
 * S3-compatible service. Never used when APP_ENV is not local/test — the real
 * client is always constructed in buildApp; callers opt into this explicitly.
 */
export function createInMemoryObjectStorage(): ObjectStorage {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    async putObject(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async getObject(key) {
      const found = objects.get(key);
      if (!found) throw new Error(`object not found: ${key}`);
      const { Readable } = await import("node:stream");
      return { stream: Readable.from(found.body), contentType: found.contentType };
    },
  };
}
