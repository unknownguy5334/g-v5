CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_admin_time_idx
  ON admin_audit_log (admin_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_action_time_idx
  ON admin_audit_log (action, timestamp DESC);
