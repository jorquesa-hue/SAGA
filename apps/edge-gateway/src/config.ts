import { loadConfig } from "@jk/domain-kernel";
import { z } from "zod";

/**
 * Edge gateway configuration (Appendix G). Startup fails with a secret-free
 * report on invalid critical config. Auth is either a local dev user id
 * (APP_ENV=local) or a bearer token; the gateway is a tenant-scoped device.
 */
export const edgeConfigSchema = z
  .object({
    APP_ENV: z.string().min(1).default("local"),
    API_BASE_URL: z.string().url().default("http://localhost:4000"),
    EDGE_TENANT_ID: z.string().uuid(),
    EDGE_GATEWAY_ID: z.string().min(1).default("edge-1"),
    EDGE_DEV_USER_ID: z.string().uuid().optional(),
    EDGE_API_TOKEN: z.string().min(1).optional(),
    EDGE_DATA_FILE: z.string().min(1).default("./data/edge-outbox.json"),
    FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(100),
    PORT: z.coerce.number().int().positive().default(4200),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .refine((c) => c.EDGE_DEV_USER_ID || c.EDGE_API_TOKEN, {
    message: "one of EDGE_DEV_USER_ID (local) or EDGE_API_TOKEN (bearer) is required",
  });

export type EdgeConfig = z.infer<typeof edgeConfigSchema>;

export function loadEdgeConfig(env: NodeJS.ProcessEnv = process.env): EdgeConfig {
  return loadConfig(edgeConfigSchema, env);
}
