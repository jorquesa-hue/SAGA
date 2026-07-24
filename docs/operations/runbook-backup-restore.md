# Runbook — Backup & Restore

Targets (§32.2): **RPO ≤ 15 min**, **RTO ≤ 4 h**. Production uses managed
PostgreSQL point-in-time recovery (PITR); this runbook covers verification and
the disaster-recovery exercise (§78). Cloud/provider specifics land with ADR-001.

## Backups

- **Production:** managed PITR enabled; full backups encrypted and stored in an
  isolated recovery account/location; object storage versioned.
- **Local/manual snapshot:**

```bash
pg_dump --format=custom --file=jk_platform.dump \
  "postgresql://jk:jk@localhost:5432/jk_platform"
```

## Restore (into an isolated environment)

```bash
createdb jk_restore
pg_restore --clean --if-exists --no-owner \
  --dbname="postgresql://jk:jk@localhost:5432/jk_restore" jk_platform.dump
```

## Restore verification (§78 — must pass)

After restoring, verify integrity and isolation, not just that it loaded:

```sql
-- Row counts match the backup manifest.
SELECT 'tenant' t, count(*) FROM tenant
UNION ALL SELECT 'animal', count(*) FROM animal
UNION ALL SELECT 'domain_event', count(*) FROM domain_event;

-- Append-only trigger still enforced.
-- (expect: ERROR "domain_event is append-only")
UPDATE domain_event SET payload = '{}'::jsonb WHERE true;

-- RLS still enforced: as jk_app with no context → 0 rows.
SET ROLE jk_app; SELECT count(*) FROM animal;  -- expect 0
RESET ROLE;
```

Also verify: migrations table intact (`SELECT * FROM schema_migration`),
attachments (object storage) reachable, and application starts against the
restored database (`/health/ready` green).

## Disaster-recovery exercise (quarterly)

1. Restore latest backup into a clean, isolated environment.
2. Run the verification queries above + `pnpm db:migrate:test` semantics.
3. Boot `apps/api` and `apps/worker` against the restored DB.
4. Record actual RPO/RTO achieved and any remediation.
5. File results as release evidence (§84 acceptance gate).

## Never

- Never restore production data into a shared/dev environment.
- Never bypass RLS or the append-only triggers to "fix" restored data —
  corrections are compensating events (§40).
