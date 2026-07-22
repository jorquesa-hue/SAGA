import { randomUUID } from "node:crypto";

/**
 * Correlation id propagation (§77): every request, command, event, job, and
 * device batch carries a correlation id so a single operation can be traced
 * end to end across API, worker, and database.
 */

export const CORRELATION_HEADER = "x-correlation-id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Return a valid correlation id: the provided one if it is a UUID, else new. */
export function resolveCorrelationId(candidate?: string | string[] | null): string {
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  if (value && UUID_RE.test(value)) {
    return value;
  }
  return randomUUID();
}
