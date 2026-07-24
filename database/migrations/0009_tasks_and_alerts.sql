-- 0009_tasks_and_alerts.sql
-- Analytics and Intelligence: planned/due work (tasks) and detected conditions
-- (alerts) with a dedupe→acknowledge→resolve lifecycle. Requirements:
-- JK-HLT-002, JK-REP-004, §26 (alerts/reports).

-- task — planned or due work derived from a source rule (protocol cadence,
-- reproduction check window, etc.), with a due window and assignment.
CREATE TABLE task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid,
  animal_id uuid,
  lot_id uuid,
  source_rule text NOT NULL,
  task_type text NOT NULL,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','overdue','cancelled')),
  assigned_to uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX task_due_idx ON task(tenant_id, status, due_at);

-- alert — a detected condition requiring attention. Deduplicated by dedupe_key
-- while unresolved (§26 "Alerts SHALL be deduplicated"), severity-rated, with
-- linked evidence and an acknowledge/resolve lifecycle.
CREATE TABLE alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid,
  animal_id uuid,
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  dedupe_key text NOT NULL,
  message text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One active (unresolved) alert per dedupe key per tenant.
CREATE UNIQUE INDEX alert_dedupe_active_unique
  ON alert(tenant_id, dedupe_key) WHERE status <> 'resolved';
CREATE INDEX alert_open_idx ON alert(tenant_id, status, severity);

ALTER TABLE task ENABLE ROW LEVEL SECURITY;
ALTER TABLE task FORCE ROW LEVEL SECURITY;
ALTER TABLE alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert FORCE ROW LEVEL SECURITY;

CREATE POLICY task_tenant_policy ON task
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY alert_tenant_policy ON alert
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON task, alert TO jk_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_worker') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON task, alert TO jk_worker';
    EXECUTE 'CREATE POLICY task_worker_policy ON task TO jk_worker USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY alert_worker_policy ON alert TO jk_worker USING (true) WITH CHECK (true)';
  END IF;
END
$$;
