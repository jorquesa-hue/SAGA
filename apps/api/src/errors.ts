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

/**
 * A money write specified a currency other than the tenant's base currency.
 * The console records in the tenant currency; cross-currency entries need FX
 * (out of scope), so a mismatch is rejected rather than silently stored. 422.
 */
export class CurrencyMismatchError extends PlatformError {
  readonly code = "JK-CURRENCY-MISMATCH";
  readonly httpStatus = 422;
}
