CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  scope TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  PRIMARY KEY (scope, bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_expires_idx
  ON rate_limit_buckets (expires_at);

ALTER TABLE payment_submissions
  ADD CONSTRAINT payment_submissions_amount_positive_chk CHECK (amount > 0 AND amount <= 100000);
