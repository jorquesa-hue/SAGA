import { PlatformError } from "@jk/domain-kernel";
import type { ReproAuthorizationDecision } from "./authorization.js";

/** Authorization denial in Reproduction and Genetics (§66). Context-owned. */
export class ReproForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
  constructor(
    message: string,
    readonly decision?: ReproAuthorizationDecision,
  ) {
    super(message);
  }
}
