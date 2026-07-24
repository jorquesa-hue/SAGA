import { PlatformError } from "@jk/domain-kernel";
import type { ImportDecision } from "./authorization.js";

/** Authorization denial in Data Import (§66). */
export class ImportForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
  constructor(
    message: string,
    readonly decision?: ImportDecision,
  ) {
    super(message);
  }
}

/** An import stage was invoked out of order (e.g. execute before validate). */
export class ImportStateError extends PlatformError {
  readonly code = "JK-IMPORT-STATE";
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message);
  }
}
