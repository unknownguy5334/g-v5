DO $$ BEGIN
  ALTER TYPE "public"."payment_status" ADD VALUE IF NOT EXISTS 'CANCELLED';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "public"."payment_submissions" ADD COLUMN IF NOT EXISTS "client_request_id" text;--> statement-breakpoint

ALTER TABLE "public"."entitlements"
  ADD COLUMN IF NOT EXISTS "revoked_at" timestamp,
  ADD COLUMN IF NOT EXISTS "revoked_by" text,
  ADD COLUMN IF NOT EXISTS "revoke_reason" text;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payment_client_request_unique"
ON "public"."payment_submissions" ("student_id", "client_request_id")
WHERE "client_request_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payment_pending_scope_unique"
ON "public"."payment_submissions" (
  "student_id",
  "plan",
  "academic_year",
  COALESCE("term", '_')
)
WHERE "payment_status" = 'PENDING';--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payment_proof_submission_unique"
ON "public"."payment_proofs" ("submission_id");--> statement-breakpoint

ALTER TABLE "public"."products"
  DROP CONSTRAINT IF EXISTS "products_amount_positive";--> statement-breakpoint
ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_amount_positive" CHECK ("amount" > 0);--> statement-breakpoint

ALTER TABLE "public"."payment_submissions"
  DROP CONSTRAINT IF EXISTS "payment_submissions_amount_positive";--> statement-breakpoint
ALTER TABLE "public"."payment_submissions"
  ADD CONSTRAINT "payment_submissions_amount_positive" CHECK ("amount" > 0);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "entitlements_student_status_idx"
ON "public"."entitlements" ("student_id", "status");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payment_submissions_scope_idx"
ON "public"."payment_submissions" ("student_id", "plan", "academic_year", "term", "payment_status");
