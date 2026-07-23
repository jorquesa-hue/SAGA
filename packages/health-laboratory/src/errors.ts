import { PlatformError } from "@jk/domain-kernel";
import type { HealthAuthorizationDecision } from "./authorization.js";

/** Authorization denial in Health and Laboratory (§66). Context-owned. */
export class HealthForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
  constructor(
    message: string,
    readonly decision?: HealthAuthorizationDecision,
  ) {
    super(message);
  }
}
