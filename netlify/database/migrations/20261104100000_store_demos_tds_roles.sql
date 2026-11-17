-- In-store demos only (no product loans), section-wise TDS, and benefit records under 194R.
ALTER TABLE payment_batch_items DROP CONSTRAINT net_adds_up;
UPDATE payment_batch_items SET net_paise = gross_paise - tds_paise WHERE demo_deduction_paise > 0;
ALTER TABLE payment_batch_items DROP COLUMN demo_deduction_paise;
ALTER TABLE payment_batch_items ADD COLUMN benefit_tds_paise BIGINT NOT NULL DEFAULT 0 CHECK (benefit_tds_paise >= 0);
ALTER TABLE payment_batch_items ADD CONSTRAINT net_adds_up CHECK (net_paise = gross_paise - tds_paise - benefit_tds_paise);
DROP TABLE demo_recoveries;
DROP TABLE demo_unit_loans;
DROP TABLE demo_units;

ALTER TABLE influencer_profiles ADD COLUMN vetting_step1_by UUID REFERENCES users(id);
ALTER TABLE influencer_profiles ADD COLUMN engagement_type TEXT NOT NULL DEFAULT 'PROFESSIONAL'
  CHECK (engagement_type IN ('PROFESSIONAL','CONTRACT_INDIVIDUAL','CONTRACT_OTHER','SALARIED'));

ALTER TABLE tds_rules ADD COLUMN code TEXT;
ALTER TABLE tds_rules ADD COLUMN single_threshold_paise BIGINT CHECK (single_threshold_paise >= 0);
UPDATE tds_rules SET code = 'PROF_194J', label = 'Professional or content creation fees';
ALTER TABLE tds_rules ALTER COLUMN code SET NOT NULL;
ALTER TABLE tds_rules ADD CONSTRAINT tds_rules_code_check CHECK (code IN ('PROF_194J','CONTRACT_194C_IND','CONTRACT_194C_OTHER','BENEFIT_194R'));
ALTER TABLE tds_rules DROP CONSTRAINT tds_rules_effective_from_key;
ALTER TABLE tds_rules ADD CONSTRAINT tds_rules_code_effective_from_key UNIQUE (code, effective_from);
INSERT INTO tds_rules (code, label, legacy_section, rate_bps, no_pan_rate_bps, annual_threshold_paise, single_threshold_paise, effective_from) VALUES
  ('CONTRACT_194C_IND',   'Contract work, individual or HUF',       '194C',  100, 2000, 10000000, 3000000, '2026-04-01'),
  ('CONTRACT_194C_OTHER', 'Contract work, company or firm',         '194C',  200, 2000, 10000000, 3000000, '2026-04-01'),
  ('BENEFIT_194R',        'Free products, gifts, travel, experiences', '194R', 1000, 2000, 2000000, NULL,  '2026-04-01')
ON CONFLICT (code, effective_from) DO NOTHING;

ALTER TABLE tds_ledger ADD COLUMN rule_code TEXT NOT NULL DEFAULT 'PROF_194J';

CREATE TABLE benefit_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id       UUID NOT NULL REFERENCES influencer_profiles(user_id),
  tds_rule_id         UUID NOT NULL REFERENCES tds_rules(id),
  description         TEXT NOT NULL,
  value_paise         BIGINT NOT NULL CHECK (value_paise > 0),
  given_on            DATE NOT NULL,
  tax_year            TEXT NOT NULL,
  tds_paise           BIGINT NOT NULL CHECK (tds_paise >= 0),
  rate_bps            INTEGER NOT NULL,
  pan_applied         BOOLEAN NOT NULL,
  pan_encrypted       TEXT,
  recover_from_payout BOOLEAN NOT NULL,
  recovered_paise     BIGINT NOT NULL DEFAULT 0 CHECK (recovered_paise >= 0),
  status              TEXT NOT NULL CHECK (status IN ('OPEN','SETTLED','VOID')),
  recorded_by         UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recovered_within_tds CHECK (recovered_paise <= tds_paise)
);
CREATE INDEX benefit_year_idx ON benefit_records (influencer_id, tax_year) WHERE status <> 'VOID';

CREATE TABLE benefit_recoveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_id      UUID NOT NULL REFERENCES benefit_records(id),
  batch_item_id   UUID NOT NULL REFERENCES payment_batch_items(id),
  amount_paise    BIGINT NOT NULL CHECK (amount_paise > 0),
  is_void         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- New terms: demos at the store only. Sample creators carry over; real ones accept again.
UPDATE legal_documents SET is_current = FALSE WHERE is_current;
INSERT INTO legal_documents (version, title, body, content_hash, is_current)
SELECT 'DRAFT-2', 'Creator Terms & Conditions', b.body, encode(digest(b.body, 'sha256'), 'hex'), TRUE
FROM (SELECT $terms$DRAFT: must be reviewed by your lawyer before use with real creators.

In these Terms, the Company means Lotus Electronics Supermarket [REGISTERED LEGAL NAME TO BE CONFIRMED BY YOUR LAWYER].

1. Intellectual property. On payment for a submission, the Creator assigns to the Company all copyright and related rights in the media created for that submission, for all media, worldwide, for the full term of copyright. The Creator confirms the media is original and that music, people and other material in it are properly licensed or consented to.

2. Brand guidelines. The Creator will follow the campaign brief and the Company's brand guidelines, and will clearly label sponsored content as an advertisement as required by applicable advertising rules.

3. Payment conditions. Payment is due only if the post is live on the Creator's own account, passes the published engagement checks and remains live through the measurement period. A post that is never published or is deleted earns no payment.

4. Tax. The Company will deduct tax at source as required by law, including on any free product, gift, travel or experience it provides. Without a valid PAN, tax is deducted at the higher rate the law sets. The Creator is responsible for their own tax filings and for accurate PAN and GST details.

5. In-store demos. Products are shown and filmed only at the store, during a visit the store has approved. No product is loaned or given to the Creator to take away.

6. Paid ad rights. The Company may request permission to run a post as a paid advertisement for 30 or 90 days. These rights begin only when the Creator accepts the request.

7. Liability. The Creator is responsible for the lawfulness of their content and for their own conduct while creating it. To the extent permitted by law, the Company is not liable for indirect losses arising from the Creator's participation.

8. Non-disparagement. While participating and for 12 months afterwards, the Creator will not publish false or misleading statements about the Company. This does not limit honest opinions, truthful statements or any legal rights.

9. Disputes. Disputes will first go through the platform's dispute desk. These Terms are governed by the laws of India, with exclusive jurisdiction in the courts of [CITY TO BE CONFIRMED BY YOUR LAWYER].
$terms$ AS body) b;
INSERT INTO legal_acceptance_logs (influencer_id, document_id, content_hash)
SELECT u.id, d.id, d.content_hash FROM users u CROSS JOIN legal_documents d
 WHERE d.is_current AND u.role = 'INFLUENCER' AND u.email LIKE 'sample.%@example.com'
   AND u.id IN (SELECT influencer_id FROM legal_acceptance_logs);
