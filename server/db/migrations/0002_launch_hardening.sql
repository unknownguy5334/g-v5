ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'STUDENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."run_status" AS ENUM('IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."access_status" AS ENUM('ACTIVE', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "student_id" text NOT NULL REFERENCES "public"."students"("id") ON DELETE CASCADE,
  "access_type" text NOT NULL,
  "status" "run_status" DEFAULT 'IN_PROGRESS' NOT NULL,
  "academic_year" text NOT NULL,
  "term" text NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "failed_at" timestamp,
  "result_created" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "amount" integer NOT NULL,
  "currency" text DEFAULT 'EGP' NOT NULL,
  "enabled" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "app_config" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "products" ("id","name","amount","currency","enabled") VALUES
('CURRENT_TERM','Current Term',89,'EGP',1),
('ACADEMIC_YEAR','Academic Year',199,'EGP',1)
ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","currency"=EXCLUDED."currency";--> statement-breakpoint
INSERT INTO "payment_methods_config" ("id","enabled","destination","instructions") VALUES
('MANUAL_INSTAPAY',0,'','Send the exact amount to the configured InstaPay account. Replace these instructions in Admin.'),
('MANUAL_TELDA',0,'','Send the exact amount to the configured Telda account. Replace these instructions in Admin.'),
('MANUAL_VODAFONE_CASH',0,'','Send the exact amount to the configured Vodafone Cash number. Replace these instructions in Admin.')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entitlement_unique_scope"
ON "entitlements" ("student_id","plan","academic_year",COALESCE("term",'_'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_sessions_student_status_idx" ON "run_sessions" ("student_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_submissions_student_status_idx" ON "payment_submissions" ("student_id","payment_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_audit_student_time_idx" ON "activity_audit" ("student_id","timestamp");
