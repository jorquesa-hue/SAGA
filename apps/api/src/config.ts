import { loadConfig } from "@jk/domain-kernel";
import { z } from "zod";

/**
 * Typed API configuration (Appendix G). Startup fails with a secret-free
 * report when critical configuration is invalid.
 *
 * Two database URLs by design (§67): DATABASE_URL is the owner/system
 * connection used only for tenant onboarding; APP_DATABASE_URL is the
 * RLS-enforced jk_app connection used for all tenant-scoped work.
 */
const configSchema = z.object({
  APP_ENV: z.enum(["local", "dev", "staging", "production"]).default("local"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  APP_DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://jk_app:jk_app_local@localhost:5432/jk_platform"),
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  AI_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  /**
   * Comma-separated allowed CORS origins for browser clients (§46). Empty in
   * production means same-origin only (no cross-origin browser access); in
   * local dev, empty reflects the request origin so the Vite dev server works.
   */
  CORS_ORIGINS: z.string().default(""),
});

export type ApiConfig = z.infer<typeof configSchema>;

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return loadConfig(configSchema, env);
}
