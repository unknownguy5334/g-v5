-- Gadwal student-product completion migration
ALTER TABLE students ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMPTZ;

ALTER TABLE products ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE saved_courses ADD COLUMN IF NOT EXISTS academic_year TEXT;
ALTER TABLE saved_courses ADD COLUMN IF NOT EXISTS term TEXT;
ALTER TABLE saved_courses ADD COLUMN IF NOT EXISTS title TEXT;

UPDATE saved_courses
SET academic_year = CASE
  WHEN EXTRACT(MONTH FROM NOW()) >= 9 THEN EXTRACT(YEAR FROM NOW())::text || '–' || (EXTRACT(YEAR FROM NOW())::int + 1)::text
  ELSE (EXTRACT(YEAR FROM NOW())::int - 1)::text || '–' || EXTRACT(YEAR FROM NOW())::text
END,
term = CASE
  WHEN EXTRACT(MONTH FROM NOW()) >= 9 OR (EXTRACT(MONTH FROM NOW()) = 1 AND EXTRACT(DAY FROM NOW()) <= 19) THEN 'FALL'
  WHEN EXTRACT(MONTH FROM NOW()) >= 2 AND EXTRACT(MONTH FROM NOW()) <= 6 OR (EXTRACT(MONTH FROM NOW()) = 1 AND EXTRACT(DAY FROM NOW()) >= 20) THEN 'SPRING'
  ELSE 'SUMMER'
END
WHERE academic_year IS NULL OR term IS NULL;

ALTER TABLE saved_courses ALTER COLUMN academic_year SET NOT NULL;
ALTER TABLE saved_courses ALTER COLUMN term SET NOT NULL;
CREATE INDEX IF NOT EXISTS saved_courses_student_context_idx ON saved_courses(student_id, academic_year, term);

ALTER TABLE saved_schedules ADD COLUMN IF NOT EXISTS is_favorite INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS saved_schedules_student_favorite_idx ON saved_schedules(student_id, is_favorite);

ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT;
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS product_version INTEGER NOT NULL DEFAULT 1;
UPDATE payment_submissions SET product_name_snapshot = CASE WHEN plan = 'CURRENT_TERM' THEN 'Current Term' ELSE 'Academic Year' END WHERE product_name_snapshot IS NULL;
ALTER TABLE payment_submissions ALTER COLUMN product_name_snapshot SET NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'INFO',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_student_created_idx ON notifications(student_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_student_read_idx ON notifications(student_id, read_at);

-- Preserve exact entitlement purchase details for historical billing/access records.
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS amount_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EGP';
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS product_version INTEGER NOT NULL DEFAULT 1;
UPDATE entitlements e
SET product_name_snapshot = COALESCE(NULLIF(e.product_name_snapshot, ''), ps.product_name_snapshot, CASE WHEN e.plan = 'CURRENT_TERM' THEN 'Current Term' ELSE 'Academic Year' END),
    amount_paid = CASE WHEN e.amount_paid = 0 AND ps.amount IS NOT NULL THEN ps.amount ELSE e.amount_paid END,
    currency = COALESCE(NULLIF(e.currency, ''), 'EGP'),
    product_version = CASE WHEN e.product_version = 1 AND ps.product_version IS NOT NULL THEN ps.product_version ELSE e.product_version END
FROM payment_submissions ps
WHERE e.submission_id = ps.id;
UPDATE entitlements SET product_name_snapshot = CASE WHEN plan = 'CURRENT_TERM' THEN 'Current Term' ELSE 'Academic Year' END WHERE product_name_snapshot IS NULL OR product_name_snapshot = '';

CREATE TABLE IF NOT EXISTS course_set_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_set_id UUID NOT NULL REFERENCES saved_courses(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_data JSONB NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS course_set_revisions_course_set_created_idx ON course_set_revisions(course_set_id, created_at);
CREATE INDEX IF NOT EXISTS course_set_revisions_student_created_idx ON course_set_revisions(student_id, created_at);


-- Final historical-billing integrity constraints. These are idempotent so the migration
-- is safe to apply exactly once through Drizzle's migration journal.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_version_positive;
ALTER TABLE products ADD CONSTRAINT products_version_positive CHECK (version >= 1);
ALTER TABLE payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_product_version_positive;
ALTER TABLE payment_submissions ADD CONSTRAINT payment_submissions_product_version_positive CHECK (product_version >= 1);
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS entitlements_amount_paid_valid;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_amount_paid_valid CHECK (amount_paid >= 0 AND amount_paid <= 100000);
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS entitlements_product_version_positive;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_product_version_positive CHECK (product_version >= 1);
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS entitlements_currency_egp;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_currency_egp CHECK (currency = 'EGP');
