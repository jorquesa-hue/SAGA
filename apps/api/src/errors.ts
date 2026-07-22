import { PlatformError } from "@jk/domain-kernel";

/** Authentication failure (no/invalid credentials). Maps to 401. */
export class UnauthorizedError extends PlatformError {
  readonly code = "JK-UNAUTHORIZED";
  readonly httpStatus = 401;
}

/** A required header (e.g. Idempotency-Key, x-tenant-id) is missing. 400. */
export class MissingHeaderError extends PlatformError {
  readonly code = "JK-MISSING-HEADER";
  readonly httpStatus = 400;
}

/** No matching route. 404. */
export class RouteNotFoundError extends PlatformError {
  readonly code = "JK-ROUTE-NOT-FOUND";
  readonly httpStatus = 404;
}
