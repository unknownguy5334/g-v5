ALTER TABLE "run_sessions" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
CREATE INDEX IF NOT EXISTS "run_sessions_student_type_status_idx" ON "run_sessions" ("student_id", "access_type", "status");
CREATE INDEX IF NOT EXISTS "payment_submissions_client_request_idx" ON "payment_submissions" ("client_request_id");
ALTER TABLE "saved_schedules" DROP CONSTRAINT IF EXISTS "saved_schedules_title_length_check";
ALTER TABLE "saved_schedules" ADD CONSTRAINT "saved_schedules_title_length_check" CHECK ("title" IS NULL OR char_length("title") <= 120);
ALTER TABLE "payment_submissions" DROP CONSTRAINT IF EXISTS "payment_submissions_full_name_length_check";
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_full_name_length_check" CHECK (char_length("full_name") BETWEEN 1 AND 120);
ALTER TABLE "payment_submissions" DROP CONSTRAINT IF EXISTS "payment_submissions_phone_length_check";
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_phone_length_check" CHECK (char_length("phone_number") BETWEEN 8 AND 20);
