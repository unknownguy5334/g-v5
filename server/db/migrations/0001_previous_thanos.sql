CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" text NOT NULL,
	"plan" text NOT NULL,
	"academic_year" text NOT NULL,
	"term" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"submission_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods_config" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"destination" text NOT NULL,
	"instructions" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" text NOT NULL,
	"plan" text NOT NULL,
	"amount" integer NOT NULL,
	"payment_method" text NOT NULL,
	"academic_year" text NOT NULL,
	"term" text,
	"full_name" text NOT NULL,
	"phone_number" text NOT NULL,
	"telda_username" text,
	"proof_id" uuid,
	"payment_status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"rejection_reason" text,
	"reviewed_at" timestamp,
	"reviewed_by" text,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_submission_id_payment_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."payment_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_proof_id_payment_proofs_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."payment_proofs"("id") ON DELETE no action ON UPDATE no action;