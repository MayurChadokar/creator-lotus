-- Either admin can approve on their own.
ALTER TABLE payment_batches DROP CONSTRAINT two_person_rule;
