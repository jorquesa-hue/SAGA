import type { ProblemDetails } from "./types.js";

/**
 * Error thrown for any non-2xx response. Carries the parsed RFC 9457 Problem
 * Details (§46.1) plus the correlation id so callers can surface a stable
 * machine `code`, field errors, and a traceable id.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail || problem.title || `HTTP ${problem.status}`);
    this.name = "ApiError";
    this.status = problem.status;
    this.code = problem.code;
    this.correlationId = problem.correlationId;
    this.problem = problem;
  }

  get fieldErrors(): Array<{ field: string; reason: string }> {
    return this.problem.errors ?? [];
  }

  /** True when the failure is a client/authorization issue the user can act on. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}
