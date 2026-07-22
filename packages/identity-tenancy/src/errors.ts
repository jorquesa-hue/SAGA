import { PlatformError } from "@jk/domain-kernel";
import { type AuthorizationDecision } from "./authorization.js";

/**
 * Authorization denial (JK-PLT-EES-001 §66). Carries the full policy decision
 * so transports and audit trails can expose the reason — UI hiding is never
 * authorization, and denials must be explainable.
 */
export class ForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;

  constructor(
    message: string,
    readonly decision?: AuthorizationDecision,
  ) {
    super(message);
  }
}
