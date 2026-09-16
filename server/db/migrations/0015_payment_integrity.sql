-- Payment-state integrity hardening. This migration corrects legacy schema/API drift
-- and binds payment submissions to their own proofs at the database boundary.

ALTER TABLE "public"."payment_submissions"
  DROP CONSTRAINT IF EXISTS "payment_submission_method_chk";
ALTER TABLE "public"."payment_submissions"
  DROP CONSTRAINT IF EXISTS "payment_submissions_method_check";
ALTER TABLE "public"."payment_submissions"
  ADD CONSTRAINT "payment_submission_method_chk"
  CHECK ("payment_method" IN ('MANUAL_INSTAPAY','MANUAL_TELDA','MANUAL_VODAFONE_CASH'));

ALTER TABLE "public"."payment_proofs"
  DROP CONSTRAINT IF EXISTS "payment_proofs_mime_type_chk";
ALTER TABLE "public"."payment_proofs"
  ADD CONSTRAINT "payment_proofs_mime_type_chk"
  CHECK ("mime_type" IN ('image/png','image/jpeg','image/webp'));

ALTER TABLE "public"."payment_submissions"
  DROP CONSTRAINT IF EXISTS "payment_submissions_amount_max_chk";
ALTER TABLE "public"."payment_submissions"
  ADD CONSTRAINT "payment_submissions_amount_max_chk"
  CHECK ("amount" > 0 AND "amount" <= 100000);

ALTER TABLE "public"."payment_submissions"
  DROP CONSTRAINT IF EXISTS "payment_submissions_product_version_positive";
ALTER TABLE "public"."payment_submissions"
  ADD CONSTRAINT "payment_submissions_product_version_positive"
  CHECK ("product_version" >= 1);

-- Normalize legacy/malformed proof pointers before adding the cross-table invariant.
UPDATE "public"."payment_submissions" ps
SET "proof_id" = NULL
WHERE "proof_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "public"."payment_proofs" pp
    WHERE pp."id" = ps."proof_id"
      AND pp."submission_id" = ps."id"
  );

CREATE UNIQUE INDEX IF NOT EXISTS "payment_proofs_id_submission_unique"
ON "public"."payment_proofs" ("id","submission_id");

ALTER TABLE "public"."payment_submissions"
  DROP CONSTRAINT IF EXISTS "payment_submissions_proof_submission_fk";
ALTER TABLE "public"."payment_submissions"
  ADD CONSTRAINT "payment_submissions_proof_submission_fk"
  FOREIGN KEY ("proof_id","id")
  REFERENCES "public"."payment_proofs" ("id","submission_id");
