import { PlatformError } from "@jk/domain-kernel";
import type { AnalyticsDecision } from "./authorization.js";

/** Authorization denial in Analytics and Intelligence (§66). Context-owned. */
export class AnalyticsForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
  constructor(
    message: string,
    readonly decision?: AnalyticsDecision,
  ) {
    super(message);
  }
}
