import { PlatformError } from "@jk/domain-kernel";
import { ZodError } from "zod";

/**
 * RFC 9457 Problem Details (§46.1). Maps domain error taxonomy and validation
 * failures to a stable wire shape with a machine code and correlation id.
 * Unexpected errors become a 500 with no internal detail leaked (JK-SEC-006).
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  correlationId: string;
  errors?: Array<{ field: string; reason: string }>;
}

const PROBLEM_BASE = "https://jk.example/problems/";

function codeToSlug(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function toProblem(error: unknown, correlationId: string): ProblemDetails {
  if (error instanceof PlatformError) {
    return {
      type: `${PROBLEM_BASE}${codeToSlug(error.code)}`,
      title: error.name,
      status: error.httpStatus,
      detail: error.message,
      code: error.code,
      correlationId,
      ...(error.fieldErrors.length > 0 ? { errors: error.fieldErrors } : {}),
    };
  }

  if (error instanceof ZodError) {
    return {
      type: `${PROBLEM_BASE}validation`,
      title: "ValidationError",
      status: 400,
      detail: "Request body failed validation",
      code: "JK-VALIDATION",
      correlationId,
      errors: error.issues.map((issue) => ({
        field: issue.path.join("."),
        reason: issue.message,
      })),
    };
  }

  // Unknown/unexpected: never leak internals.
  return {
    type: `${PROBLEM_BASE}internal`,
    title: "InternalError",
    status: 500,
    detail: "An unexpected error occurred",
    code: "JK-INTERNAL",
    correlationId,
  };
}

export const PROBLEM_CONTENT_TYPE = "application/problem+json";
