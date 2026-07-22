import { loadConfig } from "@jk/domain-kernel";
import { z } from "zod";

/**
 * Typed configuration contract for the worker (Appendix G). Startup fails
 * with an aggregated, secret-free report when critical configuration is
 * invalid (loadConfig from the kernel).
 *
 * The worker connects with the dedicated jk_worker role (least privilege,
 * cross-tenant scoped RLS policies) — never the app role.
 */

export const workerConfigSchema = z.object({
  APP_ENV: z.string().min(1).default("local"),
  WORKER_DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://jk_worker:jk_worker_local@localhost:5432/jk_platform"),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(50),
  /** Optional: when set, events are published to NATS JetStream. */
  NATS_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(4100),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return loadConfig(workerConfigSchema, env);
}
