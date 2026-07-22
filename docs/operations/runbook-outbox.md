# Runbook — Outbox backlog & publishing

The transactional outbox (`outbox_message`) is drained by `apps/worker`
(`OutboxRelay`) using `FOR UPDATE SKIP LOCKED`. Messaging is at-least-once;
consumers dedupe (§31.2).

## Symptoms

- Rising unpublished count; projections/integrations lagging.

## Diagnose (as owner or `jk_worker`)

```sql
-- Backlog size and age of the oldest unpublished message.
SELECT count(*) AS pending,
       min(created_at) AS oldest,
       now() - min(created_at) AS oldest_age
FROM outbox_message
WHERE published_at IS NULL;

-- Messages repeatedly failing to publish.
SELECT message_id, subject, publish_attempts, last_error, created_at
FROM outbox_message
WHERE published_at IS NULL AND publish_attempts > 0
ORDER BY publish_attempts DESC
LIMIT 50;
```

## Common causes & actions

| Cause | Action |
|---|---|
| Worker not running | start `apps/worker`; check `/health/ready` on its port (default 4100) |
| Broker unreachable (NATS) | verify `NATS_URL`; the relay records `last_error` and retries; fix connectivity |
| Poison message (validation) | inspect `envelope`; the relay isolates per-message via SAVEPOINT so one bad row does not block the batch |
| Throughput | raise `OUTBOX_BATCH_SIZE` / lower `POLL_INTERVAL_MS`; scale worker replicas (SKIP LOCKED makes this safe) |

## Replay / recovery

Publishing is idempotent (NATS `msgID = eventId`; consumers dedupe via
`processed_message`). To force re-evaluation of a stuck message after fixing the
cause, clear its error state (owner):

```sql
UPDATE outbox_message
SET publish_attempts = 0, last_error = NULL
WHERE message_id = $1 AND published_at IS NULL;
```

Never delete `domain_event` rows (append-only). Projections are rebuildable from
the ledger; a full rebuild re-reads events and re-applies idempotent upserts.

## Metrics to watch (§77)

Outbox backlog size, oldest-unpublished age, publish failure rate, consumer
lag, dead-letter count.
