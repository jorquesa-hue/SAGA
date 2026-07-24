import { PlatformError } from "@jk/domain-kernel";
import type { IntegrationDecision } from "./authorization.js";

/** Authorization denial in Automation and Integration (§66). */
export class IntegrationForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
  constructor(
    message: string,
    readonly decision?: IntegrationDecision,
  ) {
    super(message);
  }
}

/** A subscription requested an event family outside the allowlist (§51). */
export class EventFamilyNotAllowedError extends PlatformError {
  readonly code = "JK-WEBHOOK-FAMILY-NOT-ALLOWED";
  readonly httpStatus = 422;
  constructor(
    message: string,
    readonly families: string[],
  ) {
    super(message);
  }
}
