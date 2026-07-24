import { type z } from "zod";

/**
 * Typed configuration loader (Appendix G): applications declare a zod schema
 * for their environment contract and fail startup with an aggregated,
 * secret-free error report when critical configuration is invalid.
 */
export function loadConfig<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<TSchema> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    // Never echo raw values: only variable names and reasons.
    throw new Error(`Invalid configuration:\n${details}`);
  }
  return result.data;
}
