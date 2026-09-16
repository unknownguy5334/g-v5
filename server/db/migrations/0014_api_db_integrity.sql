-- Database/API integrity hardening for race-safe business invariants.
-- Drop the legacy unconditional entitlement scope uniqueness. Historical revoked
-- entitlements must not block a later legitimate purchase for the same period.
DROP INDEX IF EXISTS "entitlement_unique_scope";

-- Only one ACTIVE entitlement may exist for a student/product/academic scope.
CREATE UNIQUE INDEX IF NOT EXISTS "entitlements_active_scope_unique"
ON "public"."entitlements" (
  "student_id",
  "plan",
  "academic_year",
  COALESCE("term", '_')
)
WHERE "status" = 'ACTIVE';

-- Course-set revisions must belong to the same student as their parent course set.
-- The existing primary key makes (id, student_id) unique as a pair.
DELETE FROM "public"."course_set_revisions" csr
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."saved_courses" sc
  WHERE sc.id = csr.course_set_id AND sc.student_id = csr.student_id
);
ALTER TABLE "public"."saved_courses"
  ADD CONSTRAINT "saved_courses_id_student_unique" UNIQUE ("id", "student_id");
ALTER TABLE "public"."course_set_revisions"
  ADD CONSTRAINT "course_set_revisions_course_set_student_fk"
  FOREIGN KEY ("course_set_id", "student_id")
  REFERENCES "public"."saved_courses" ("id", "student_id")
  ON DELETE CASCADE;

-- Favorite is a per-student singleton state. Normalize existing duplicates before
-- enforcing the invariant so concurrent requests cannot leave multiple favorites.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY updated_at DESC, created_at DESC, id DESC) AS rn
  FROM "public"."saved_schedules"
  WHERE is_favorite = 1
)
UPDATE "public"."saved_schedules" s
SET is_favorite = 0, updated_at = NOW()
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "saved_schedules_one_favorite_per_student"
ON "public"."saved_schedules" ("student_id")
WHERE "is_favorite" = 1;
