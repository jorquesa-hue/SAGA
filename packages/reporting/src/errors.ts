import { PlatformError } from "@jk/domain-kernel";

/** Authorization denial in Reporting (§47, §66). Context-owned. */
export class ReportingForbiddenError extends PlatformError {
  readonly code = "JK-FORBIDDEN";
  readonly httpStatus = 403;
}

/** A report key that is not in the catalogue (§26). */
export class UnknownReportError extends PlatformError {
  readonly code = "JK-REPORT-UNKNOWN";
  readonly httpStatus = 404;
}
