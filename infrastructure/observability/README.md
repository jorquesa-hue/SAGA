# Observability baseline

Local telemetry backbone for JK Platform per **JK-PLT-EES-001 §77** and the
§30 technology baseline (OpenTelemetry, Prometheus-compatible metrics,
structured logs).

## What exists in Phase 0

- `otel-collector-config.yaml` — OTLP (gRPC 4317 / HTTP 4318) ingest,
  `memory_limiter` + `batch` processors, `debug` exporter for local
  visibility, Prometheus exposition on `:8889`, `health_check` extension on
  `:13133`. Mounted by `infrastructure/compose/docker-compose.yml`.
- Services export via `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`
  and emit structured logs with service, environment, pseudonymous tenant
  key (where permitted), actor/source type, operation, outcome, latency, and
  error code (§77) — no secrets, no raw tenant identifiers in metric labels.

## Phase 1 dashboard/alert TODO inventory (§77 required service indicators)

Each indicator below needs a dashboard panel and, where marked, an
actionable alert with a runbook link. Alerts MUST avoid high-cardinality
tenant identifiers in metric labels.

| #   | Indicator (§77)                                                           | Source                                      | Dashboard | Alert                                   |
| --- | ------------------------------------------------------------------------- | ------------------------------------------- | --------- | --------------------------------------- |
| 1   | Request rate, latency, error, saturation (RED + saturation)               | api (HTTP metrics)                          | TODO      | TODO: latency SLO burn, error-rate burn |
| 2   | Database connections, query latency, replication/backup health            | postgres + api/worker pools                 | TODO      | TODO: pool exhaustion, backup failure   |
| 3   | Outbox backlog and publish age                                            | worker outbox relay                         | TODO      | TODO: publish age > threshold           |
| 4   | Consumer lag, retry, dead-letter count                                    | worker projections / NATS JetStream         | TODO      | TODO: DLQ > 0, lag growth               |
| 5   | Sync backlog age and conflict count                                       | sync service (lands with mobile/sync phase) | TODO      | TODO                                    |
| 6   | Device/gateway heartbeat and queue depth                                  | edge-gateway (lands with edge phase)        | TODO      | TODO: heartbeat missed                  |
| 7   | File scan failures                                                        | object-storage scan pipeline                | TODO      | TODO: scan failure > 0                  |
| 8   | Authentication/authorization failures                                     | api + identity provider                     | TODO      | TODO: failure spike (possible attack)   |
| 9   | AI request latency, cost, evidence rate, approval rate, safety block rate | ai-orchestrator (Phase 5)                   | TODO      | TODO: cost budget, safety block spike   |

Also required by §77 and carried by the platform from Phase 0:

- every request, command, event, job, device batch, and AI tool chain
  carries a correlation/trace ID (propagated via OTLP context);
- alerts are actionable and link to runbooks (runbook repository lands with
  the Phase 1 alerting work).

## Deferred decisions

- Managed observability vendor/stack for production (dashboards, alert
  routing, long-term storage) follows the cloud provider decision
  (**ADR-001**); the OTLP boundary here keeps services vendor-neutral.
