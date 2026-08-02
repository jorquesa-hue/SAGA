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

/** A multipart upload had no file part, or a mimetype outside the accepted set. 415. */
export class UnsupportedMediaTypeError extends PlatformError {
  readonly code = "JK-UNSUPPORTED-MEDIA-TYPE";
  readonly httpStatus = 415;
}

/** An uploaded file exceeded the configured size limit. 413. */
export class PayloadTooLargeError extends PlatformError {
  readonly code = "JK-PAYLOAD-TOO-LARGE";
  readonly httpStatus = 413;
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
