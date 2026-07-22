/**
 * Minimal pino-style structured JSON-line logger (§77).
 *
 * NOTE FOR INTEGRATOR: @jk/observability is declared as a dependency but was
 * not built when this app was implemented, so the worker deliberately does not
 * import it. This module keeps the same shape a pino logger exposes
 * (level methods + child bindings) so swapping to @jk/observability later is
 * a one-file change.
 *
 * Rules (§77, CLAUDE.md): structured JSON lines, correlation ids where known,
 * never secrets, never raw tenant ids in log output.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  level?: LogLevel;
  /** Injectable sink for tests; defaults to console. */
  write?: (line: string) => void;
}

export function createLogger(
  bindings: Record<string, unknown> = {},
  options: LoggerOptions = {},
): Logger {
  const threshold = LEVEL_ORDER[options.level ?? "info"];
  const write =
    options.write ??
    ((line: string) => {
      // eslint-disable-next-line no-console
      console.log(line);
    });

  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    write(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        ...bindings,
        ...fields,
        msg,
      }),
    );
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }, options),
  };
}

/** No-op logger for tests that do not assert on log output. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
