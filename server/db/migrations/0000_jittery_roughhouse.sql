CREATE TYPE "public"."free_run_status" AS ENUM('available', 'in-progress', 'used');--> statement-breakpoint
CREATE TYPE "public"."term_override_mode" AS ENUM('AUTO', 'FALL', 'SPRING', 'SUMMER');--> statement-breakpoint
CREATE TABLE "activity_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" text NOT NULL,
	"event_type" text NOT NULL,
	"metadata" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"id" text PRIMARY KEY NOT NULL,
	"term_override_mode" "term_override_mode" DEFAULT 'AUTO' NOT NULL,
	"free_run_allowance" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" text NOT NULL,
	"course_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" text NOT NULL,
	"academic_year" text NOT NULL,
	"term" text NOT NULL,
	"title" text,
	"schedule_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	"free_run_status" "free_run_status" DEFAULT 'available' NOT NULL,
	"free_run_started_at" timestamp,
	"free_run_completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "activity_audit" ADD CONSTRAINT "activity_audit_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_courses" ADD CONSTRAINT "saved_courses_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_schedules" ADD CONSTRAINT "saved_schedules_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;