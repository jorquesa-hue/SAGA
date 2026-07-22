/**
 * Error taxonomy for the platform. Every error carries a stable machine code
 * (used in RFC 9457 Problem Details responses, JK-PLT-EES-001 §46.1) and an
 * HTTP status hint. Transport layers map these; domain code never imports
 * HTTP frameworks.
 */

export type ErrorCode =
  | "JK-VALIDATION"
  | "JK-NOT-FOUND"
  | "JK-CONFLICT"
  | "JK-IDEMPOTENCY-CONFLICT"
  | "JK-CONCURRENCY-CONFLICT"
  | "JK-TENANT-ISOLATION"
  | "JK-INVARIANT"
  | "JK-UNAUTHORIZED"
  | "JK-FORBIDDEN"
  | (string & {});

export interface FieldError {
  field: string;
  reason: string;
}

export abstract class PlatformError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;
  readonly fieldErrors: FieldError[];

  constructor(message: string, fieldErrors: FieldError[] = []) {
    super(message);
    this.name = new.target.name;
    this.fieldErrors = fieldErrors;
  }
}

/** Input failed validation before reaching domain rules. Maps to 400. */
export class ValidationError extends PlatformError {
  readonly code = "JK-VALIDATION";
  readonly httpStatus = 400;
}

/** Referenced aggregate does not exist or is not visible in this tenant. 404. */
export class NotFoundError extends PlatformError {
  readonly code = "JK-NOT-FOUND";
  readonly httpStatus = 404;
}

/** A business rule conflict (e.g. duplicate active identifier). 409. */
export class ConflictError extends PlatformError {
  readonly code: ErrorCode;
  readonly httpStatus = 409;
  constructor(message: string, code: ErrorCode = "JK-CONFLICT") {
    super(message);
    this.code = code;
  }
}

/** Same idempotency key seen with a different payload. 409. */
export class IdempotencyConflictError extends PlatformError {
  readonly code = "JK-IDEMPOTENCY-CONFLICT";
  readonly httpStatus = 409;
}

/** Optimistic concurrency (aggregate version) conflict. 409. */
export class ConcurrencyConflictError extends PlatformError {
  readonly code = "JK-CONCURRENCY-CONFLICT";
  readonly httpStatus = 409;
  constructor(
    message: string,
    readonly expectedVersion?: number,
    readonly actualVersion?: number,
  ) {
    super(message);
  }
}

/**
 * A code path attempted to touch data outside the active tenant context.
 * This is always a defect or an attack; it is logged and audited. 403.
 */
export class TenantIsolationError extends PlatformError {
  readonly code = "JK-TENANT-ISOLATION";
  readonly httpStatus = 403;
}

/** A domain invariant was violated (JK-DOM-*). 422. */
export class InvariantViolationError extends PlatformError {
  readonly code = "JK-INVARIANT";
  readonly httpStatus = 422;
}
