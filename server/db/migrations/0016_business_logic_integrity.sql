-- Business-logic integrity: only a server-issued scheduling result token may be saved for a run.
ALTER TABLE "public"."run_sessions"
  ADD COLUMN IF NOT EXISTS "result_token_hash" text;
