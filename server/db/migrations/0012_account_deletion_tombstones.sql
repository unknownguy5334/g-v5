-- Preserve a non-reversible deletion marker so purged Gadwal data cannot be recreated
-- automatically by a still-existing upstream auth identity. Only a SHA-256 user-id
-- hash is retained; no email, name, course, schedule, or payment data is kept.
CREATE TABLE IF NOT EXISTS account_deletion_tombstones (
  user_id_hash TEXT PRIMARY KEY,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
