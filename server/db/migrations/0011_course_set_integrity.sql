-- Enforce one current course set per student and academic period.
-- Clean up any accidental duplicates first, retaining the most recently updated row
-- so the unique index can be applied safely on existing deployments.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY student_id, academic_year, term
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS rn
  FROM saved_courses
)
DELETE FROM saved_courses sc
USING ranked r
WHERE sc.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS saved_courses_student_context_unique
  ON saved_courses(student_id, academic_year, term);

ALTER TABLE saved_courses DROP CONSTRAINT IF EXISTS saved_courses_term_shape_check;
ALTER TABLE saved_courses ADD CONSTRAINT saved_courses_term_shape_check
  CHECK (term IN ('FALL','SPRING','SUMMER'));
