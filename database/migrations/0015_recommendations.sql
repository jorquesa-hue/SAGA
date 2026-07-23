-- 0015_recommendations.sql
-- Governed AI: evidence-bound recommendations with an approval lifecycle and
-- an audited AI-action log. Requirements: JK-CON-005/006, JK-DOM-012,
-- §61-§64. High-impact actions remain proposals until a human approves; some
-- actions are prohibited from autonomous execution entirely.

CREATE TABLE recommendation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid,
  agent_name text NOT NULL,
  model_provider text NOT NULL,
  model_version text NOT NULL,
  prompt_version text NOT NULL,
  recommendation_text text NOT NULL,
  proposed_action_category text NOT NULL,
  proposed_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Evidence (§62): domain event IDs the recommendation is grounded in.
  evidence_event_ids text[] NOT NULL,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  assumptions text,
  risk_class text NOT NULL CHECK (risk_class IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired','executed')),
  approved_by uuid,
  approved_at timestamptz,
  rejected_reason text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_id text,
  -- A recommendation must cite evidence (§62; enforced in code too).
  CHECK (array_length(evidence_event_ids, 1) >= 1)
);

CREATE INDEX recommendation_status_idx ON recommendation(tenant_id, status, created_at DESC);

-- Append-only audit of AI actions/tool calls and safety blocks (§62, §68).
CREATE TABLE ai_action_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  recommendation_id uuid,
  agent_name text,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('created','approved','rejected','executed','blocked')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_action_audit_idx ON ai_action_audit(tenant_id, recorded_at DESC);

CREATE TRIGGER ai_action_audit_no_update
  BEFORE UPDATE OR DELETE ON ai_action_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

ALTER TABLE recommendation ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_action_audit FORCE ROW LEVEL SECURITY;

CREATE POLICY recommendation_tenant_policy ON recommendation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY ai_action_audit_tenant_policy ON ai_action_audit
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON recommendation TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT ON ai_action_audit TO jk_app';
  END IF;
END
$$;
