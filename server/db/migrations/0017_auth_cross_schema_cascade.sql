-- Cross-Schema Cascade Delete Triggers between public and neon_auth

CREATE OR REPLACE FUNCTION public.cascade_student_deletion()
RETURNS TRIGGER AS $func$
BEGIN
  DELETE FROM neon_auth.session WHERE "userId"::text = OLD.id::text;
  DELETE FROM neon_auth.account WHERE "userId"::text = OLD.id::text;
  DELETE FROM neon_auth.verification WHERE identifier LIKE concat('%', OLD.email, '%');
  DELETE FROM neon_auth.user WHERE id::text = OLD.id::text OR lower(email) = lower(OLD.email);
  DELETE FROM public.student_profiles WHERE user_id::text = OLD.id::text OR lower(email) = lower(OLD.email);
  RETURN OLD;
END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cascade_student_deletion ON public.students;
CREATE TRIGGER trg_cascade_student_deletion
AFTER DELETE ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.cascade_student_deletion();

CREATE OR REPLACE FUNCTION public.cascade_neon_user_deletion()
RETURNS TRIGGER AS $func$
BEGIN
  DELETE FROM public.students WHERE id::text = OLD.id::text OR lower(email) = lower(OLD.email);
  DELETE FROM public.student_profiles WHERE user_id::text = OLD.id::text OR lower(email) = lower(OLD.email);
  RETURN OLD;
END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cascade_neon_user_deletion ON neon_auth.user;
CREATE TRIGGER trg_cascade_neon_user_deletion
AFTER DELETE ON neon_auth.user
FOR EACH ROW
EXECUTE FUNCTION public.cascade_neon_user_deletion();
