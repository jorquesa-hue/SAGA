import { pino, type Logger as PinoLogger } from "pino";

/**
 * Structured, secret-safe logging (JK-PLT-EES-001 §77, JK-SEC-006).
 *
 * Logs are JSON lines with service/environment context and a correlation id.
 * A redaction list removes tokens, passwords, secrets, and authorization
 * headers so they can never reach a log sink. Business/personal data beyond
 * identifiers SHOULD NOT be logged by callers.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerOptions {
  service: string;
  environment: string;
  level?: LogLevel;
}

/** Paths redacted from every log record (case-sensitive, dot notation). */
const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.set_config",
  "*.databaseUrl",
  "*.DATABASE_URL",
];

export type Logger = PinoLogger;

export function createLogger(options: LoggerOptions): Logger {
  return pino({
    level: options.level ?? "info",
    base: {
      service: options.service,
      env: options.environment,
    },
    redact: {
      paths: REDACT_PATHS,
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

/** A no-op logger for tests that assert on behavior, not output. */
export const silentLogger: Logger = pino({ level: "silent" });
