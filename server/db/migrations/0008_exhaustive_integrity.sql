ALTER TABLE payment_submissions
  ADD CONSTRAINT payment_submission_plan_chk CHECK (plan IN ('CURRENT_TERM', 'ACADEMIC_YEAR'));

ALTER TABLE payment_submissions
  ADD CONSTRAINT payment_submission_method_chk CHECK (payment_method IN ('MANUAL_INSTAPAY', 'MANUAL_TELDA', 'MANUAL_VODAFONE_CASH', 'PAYMOB'));

ALTER TABLE payment_submissions
  ADD CONSTRAINT payment_submission_term_chk CHECK (
    (plan = 'CURRENT_TERM' AND term IN ('FALL', 'SPRING', 'SUMMER'))
    OR (plan = 'ACADEMIC_YEAR' AND term IS NULL)
  );

ALTER TABLE payment_proofs
  ADD CONSTRAINT payment_proofs_submission_fk
  FOREIGN KEY (submission_id) REFERENCES payment_submissions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS payment_proofs_created_idx
  ON payment_proofs(created_at);


ALTER TABLE run_sessions
  ADD CONSTRAINT run_sessions_access_type_chk CHECK (access_type IN ('FREE_RUN', 'PAID'));

ALTER TABLE products
  ADD CONSTRAINT products_currency_chk CHECK (currency = 'EGP');

ALTER TABLE products
  ADD CONSTRAINT products_amount_positive_chk CHECK (amount > 0 AND amount <= 100000);
