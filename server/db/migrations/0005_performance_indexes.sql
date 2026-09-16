-- Performance hardening: indexes match real launch query patterns without changing behavior.
CREATE INDEX IF NOT EXISTS "saved_schedules_student_created_idx"
ON "public"."saved_schedules" ("student_id", "created_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "saved_schedules_academic_term_idx"
ON "public"."saved_schedules" ("academic_year", "term");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payment_submissions_status_created_idx"
ON "public"."payment_submissions" ("payment_status", "created_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payment_submissions_student_created_idx"
ON "public"."payment_submissions" ("student_id", "created_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payment_proofs_submission_idx"
ON "public"."payment_proofs" ("submission_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "entitlements_student_created_idx"
ON "public"."entitlements" ("student_id", "created_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "entitlements_academic_term_status_idx"
ON "public"."entitlements" ("academic_year", "term", "status");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "run_sessions_student_started_idx"
ON "public"."run_sessions" ("student_id", "started_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "activity_audit_event_time_idx"
ON "public"."activity_audit" ("event_type", "timestamp" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "students_last_active_idx"
ON "public"."students" ("last_active_at" DESC);--> statement-breakpoint
