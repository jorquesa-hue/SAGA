import { trace, type Span, type Tracer } from "@opentelemetry/api";

/**
 * OpenTelemetry baseline (§77). The API and worker obtain a tracer here.
 * A full SDK/exporter wiring (OTLP to the collector) is configured at the
 * application entry point behind OTEL_EXPORTER_OTLP_ENDPOINT; this module
 * provides the tracer handle and a small helper so instrumentation reads the
 * same way everywhere and is a no-op when no SDK is registered.
 */

export function getTracer(name: string, version?: string): Tracer {
  return trace.getTracer(name, version);
}

/** Run `fn` inside a span, recording errors and always ending the span. */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
