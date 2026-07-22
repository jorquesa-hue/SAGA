import { PlatformError } from "@jk/domain-kernel";
import type { HerdAuthorizationDecision } from "./authorization.js";

/** Authorization denial in Herd Operations (§66). Context-owned (no cross-context imports). */
export class HerdForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
  constructor(
    message: string,
    readonly decision?: HerdAuthorizationDecision,
  ) {
    super(message);
  }
}
