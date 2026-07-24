import { PlatformError } from "@jk/domain-kernel";
import type { AnimalAuthorizationDecision } from "./authorization.js";

/**
 * Authorization denial in the Animal Registry context (§66). Each context owns
 * its ForbiddenError so modules stay decoupled (no cross-context imports); the
 * shared error taxonomy lives in @jk/domain-kernel.
 */
export class AnimalForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
  constructor(
    message: string,
    readonly decision?: AnimalAuthorizationDecision,
  ) {
    super(message);
  }
}
