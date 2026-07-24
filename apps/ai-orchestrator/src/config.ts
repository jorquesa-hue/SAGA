import { loadConfig } from "@jk/domain-kernel";
import { z } from "zod";

/**
 * AI orchestrator configuration (Appendix G). The kill switch (AI_ENABLED)
 * defaults OFF; generation stays disabled until a tenant explicitly enables
 * it. The model provider is deterministic until ADR-008 closes.
 */
export const orchestratorConfigSchema = z.object({
  APP_ENV: z.string().min(1).default("local"),
  // Owner connection: used only to enumerate active tenants to analyze.
  DATABASE_URL: z.string().min(1),
  // RLS-enforced app connection for evidence reads and recommendation writes.
  APP_DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://jk_app:jk_app_local@localhost:5432/jk_platform"),
  AI_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  ANALYZE_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  PORT: z.coerce.number().int().positive().default(4300),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type OrchestratorConfig = z.infer<typeof orchestratorConfigSchema>;

export function loadOrchestratorConfig(
  env: NodeJS.ProcessEnv = process.env,
): OrchestratorConfig {
  return loadConfig(orchestratorConfigSchema, env);
}
