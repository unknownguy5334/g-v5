-- Adversarial red-team hardening: make business invariants explicit at the DB boundary.
-- These constraints complement application validation and prevent tampering/race-condition gaps.

ALTER TABLE "public"."payment_submissions"
  DROP CONSTRAINT IF EXISTS "payment_submissions_plan_check";
ALTER TABLE "public"."payment_submissions"
  ADD CONSTRAINT "payment_submissions_plan_check"
  CHECK ("plan" IN ('CURRENT_TERM','ACADEMIC_YEAR'));

ALTER TABLE "public"."payment_submissions"
  DROP CONSTRAINT IF EXISTS "payment_submissions_method_check";
ALTER TABLE "public"."payment_submissions"
  ADD CONSTRAINT "payment_submissions_method_check"
  CHECK ("payment_method" IN ('MANUAL_INSTAPAY','MANUAL_TELDA','MANUAL_VODAFONE_CASH'));

ALTER TABLE "public"."payment_submissions"
  DROP CONSTRAINT IF EXISTS "payment_submissions_term_shape_check";
ALTER TABLE "public"."payment_submissions"
  ADD CONSTRAINT "payment_submissions_term_shape_check"
  CHECK (("plan" = 'CURRENT_TERM' AND "term" IN ('FALL','SPRING','SUMMER')) OR ("plan" = 'ACADEMIC_YEAR' AND "term" IS NULL));

ALTER TABLE "public"."entitlements"
  DROP CONSTRAINT IF EXISTS "entitlements_plan_check";
ALTER TABLE "public"."entitlements"
  ADD CONSTRAINT "entitlements_plan_check"
  CHECK ("plan" IN ('CURRENT_TERM','ACADEMIC_YEAR'));

ALTER TABLE "public"."entitlements"
  DROP CONSTRAINT IF EXISTS "entitlements_term_shape_check";
ALTER TABLE "public"."entitlements"
  ADD CONSTRAINT "entitlements_term_shape_check"
  CHECK (("plan" = 'CURRENT_TERM' AND "term" IN ('FALL','SPRING','SUMMER')) OR ("plan" = 'ACADEMIC_YEAR' AND "term" IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS "entitlements_active_scope_unique"
ON "public"."entitlements" (
  "student_id",
  "plan",
  "academic_year",
  COALESCE("term", '_')
)
WHERE "status" = 'ACTIVE';

ALTER TABLE "public"."students"
  DROP CONSTRAINT IF EXISTS "students_role_check";
ALTER TABLE "public"."students"
  ADD CONSTRAINT "students_role_check"
  CHECK ("role" IN ('STUDENT','ADMIN'));
