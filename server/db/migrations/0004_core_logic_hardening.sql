ALTER TABLE "saved_schedules" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "saved_schedules" DROP CONSTRAINT IF EXISTS "saved_schedules_run_id_run_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "saved_schedules" ADD CONSTRAINT "saved_schedules_run_id_run_sessions_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run_sessions"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_schedules_run_id_idx" ON "saved_schedules" ("run_id");--> statement-breakpoint
