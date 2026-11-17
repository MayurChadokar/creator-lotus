-- =====================================================================
-- Localized Influencer Management & Campaign Platform: database schema
-- PostgreSQL 14+
--
-- House rules used everywhere in this file:
--   * All money is stored as whole paise (BIGINT). Rs 1,500.50 = 150050.
--     Decimals are never used for money, so rounding drift cannot happen.
--   * Multipliers and percentages are basis points (INTEGER):
--     1.50x = 15000, 10% = 1000, 1.5% engagement = 150.
--   * All timestamps are TIMESTAMPTZ.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Stores
-- ---------------------------------------------------------------------
CREATE TABLE stores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  latitude    DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Users (all three portals share this table)
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role           TEXT NOT NULL CHECK (role IN ('ADMIN','STORE_MANAGER','INFLUENCER')),
  full_name      TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  phone          TEXT UNIQUE,
  password_hash  TEXT NOT NULL,
  store_id       UUID REFERENCES stores(id),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  token_version  INTEGER NOT NULL DEFAULT 0,   -- raising it logs out every session
  totp_secret_enc TEXT,                        -- admin two-step login, encrypted
  mfa_enabled_at TIMESTAMPTZ,
  recovery_hashes TEXT[] NOT NULL DEFAULT '{}',
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_totp_step BIGINT,                       -- stops a code being used twice
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT manager_has_store CHECK (role <> 'STORE_MANAGER' OR store_id IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Payment matrix: tiers, categories, rate cards
-- ---------------------------------------------------------------------
CREATE TABLE tiers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT NOT NULL UNIQUE,
  rank                     INTEGER NOT NULL UNIQUE,   -- 1 = entry level
  min_avg_views            BIGINT NOT NULL DEFAULT 0, -- needed to hold this tier
  min_engagement_bps       INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  multiplier_bps  INTEGER NOT NULL DEFAULT 10000 CHECK (multiplier_bps > 0)
);

CREATE TABLE rate_cards (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id                UUID NOT NULL REFERENCES tiers(id) UNIQUE,
  base_pay_paise         BIGINT NOT NULL CHECK (base_pay_paise >= 0),
  bonus_per_10k_paise    BIGINT NOT NULL CHECK (bonus_per_10k_paise >= 0),
  max_view_bonus_paise   BIGINT NOT NULL CHECK (max_view_bonus_paise >= 0),
  updated_by             UUID REFERENCES users(id),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Influencers
-- ---------------------------------------------------------------------
CREATE TABLE influencer_profiles (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  tier_id            UUID NOT NULL REFERENCES tiers(id),
  tier_locked        BOOLEAN NOT NULL DEFAULT FALSE, -- admin pinned; auto-tiering skips
  city               TEXT,
  latitude           DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
  longitude          DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  -- Two-step vetting: store manager first, then admin
  vetting_status     TEXT NOT NULL DEFAULT 'PENDING_STEP_1'
                     CHECK (vetting_status IN ('PENDING_STEP_1','PENDING_STEP_2','APPROVED','REJECTED')),
  is_blacklisted     BOOLEAN NOT NULL DEFAULT FALSE,
  blacklist_reason   TEXT,
  home_store_id      UUID REFERENCES stores(id),
  privacy_accepted_at TIMESTAMPTZ,
  erased_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE custom_rate_cards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id         UUID NOT NULL REFERENCES influencer_profiles(user_id) UNIQUE,
  base_pay_paise        BIGINT NOT NULL CHECK (base_pay_paise >= 0),
  bonus_per_10k_paise   BIGINT NOT NULL CHECK (bonus_per_10k_paise >= 0),
  max_view_bonus_paise  BIGINT NOT NULL CHECK (max_view_bonus_paise >= 0),
  reason                TEXT NOT NULL,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A social account must be connected before posts can be verified.
CREATE TABLE social_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id      UUID NOT NULL REFERENCES influencer_profiles(user_id),
  platform           TEXT NOT NULL CHECK (platform IN ('INSTAGRAM','YOUTUBE')),
  external_id        TEXT NOT NULL,       -- Instagram user id or YouTube channel id
  handle             TEXT NOT NULL,
  followers          BIGINT,
  access_token_enc   TEXT,                -- encrypted; Instagram only
  token_expires_at   TIMESTAMPTZ,
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id),         -- one account cannot serve two creators
  UNIQUE (influencer_id, platform)
);

-- Tax & payout identity. Full PAN and bank number are only ever stored encrypted.
CREATE TABLE tax_records (
  influencer_id        UUID PRIMARY KEY REFERENCES influencer_profiles(user_id),
  pan_encrypted        TEXT NOT NULL,
  pan_lookup_hash      TEXT NOT NULL UNIQUE, -- keyed hash, blocks duplicate PANs
  pan_last4            TEXT NOT NULL,
  legal_name           TEXT NOT NULL,
  pan_status           TEXT NOT NULL DEFAULT 'UNVERIFIED'
                       CHECK (pan_status IN ('UNVERIFIED','VERIFIED','INOPERATIVE')),
  gstin                TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payout_accounts (
  influencer_id          UUID PRIMARY KEY REFERENCES influencer_profiles(user_id),
  account_type           TEXT NOT NULL CHECK (account_type IN ('BANK','UPI')),
  account_holder         TEXT NOT NULL,
  account_number_enc     TEXT,
  ifsc                   TEXT,
  upi_id                 TEXT,
  masked_display         TEXT NOT NULL,
  verified_at            TIMESTAMPTZ,          -- NULL until an admin confirms; any change clears it
  verified_by            UUID REFERENCES users(id),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payout_account_shape CHECK (
    (account_type = 'BANK' AND account_number_enc IS NOT NULL AND ifsc IS NOT NULL)
    OR (account_type = 'UPI' AND upi_id IS NOT NULL))
);

-- TDS rules live in data so a Finance Act change is an admin edit, not a code change.
CREATE TABLE tds_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label                   TEXT NOT NULL,
  legacy_section          TEXT NOT NULL,
  rate_bps                INTEGER NOT NULL CHECK (rate_bps >= 0),
  no_pan_rate_bps         INTEGER NOT NULL CHECK (no_pan_rate_bps >= 0),
  annual_threshold_paise  BIGINT NOT NULL CHECK (annual_threshold_paise >= 0),
  effective_from          DATE NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------
-- Legal
-- ---------------------------------------------------------------------
CREATE TABLE legal_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version      TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  is_current   BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_current_legal_document ON legal_documents (is_current) WHERE is_current;

CREATE TABLE legal_acceptance_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id   UUID NOT NULL REFERENCES influencer_profiles(user_id),
  document_id     UUID NOT NULL REFERENCES legal_documents(id),
  content_hash    TEXT NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (influencer_id, document_id)
);

-- ---------------------------------------------------------------------
-- Campaigns and budgets
-- ---------------------------------------------------------------------
CREATE TABLE campaigns (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   TEXT NOT NULL,
  brief                   TEXT NOT NULL,
  category_id             UUID NOT NULL REFERENCES product_categories(id),
  -- DRAFT -> OPEN <-> PAUSED; OPEN <-> LOCKED (automatic); any -> CLOSED / EXPIRED
  status                  TEXT NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','OPEN','PAUSED','LOCKED','CLOSED','EXPIRED')),
  lock_reason             TEXT CHECK (lock_reason IN ('BUDGET','QUOTA')),
  starts_at               TIMESTAMPTZ NOT NULL,
  expires_at              TIMESTAMPTZ NOT NULL,
  budget_paise            BIGINT NOT NULL CHECK (budget_paise > 0),
  reserved_paise          BIGINT NOT NULL DEFAULT 0 CHECK (reserved_paise >= 0),
  submission_quota        INTEGER NOT NULL CHECK (submission_quota > 0),
  active_submissions      INTEGER NOT NULL DEFAULT 0 CHECK (active_submissions >= 0),
  min_engagement_bps      INTEGER NOT NULL DEFAULT 150 CHECK (min_engagement_bps BETWEEN 0 AND 10000),
  min_views               BIGINT NOT NULL DEFAULT 500 CHECK (min_views >= 0),
  measurement_days        INTEGER NOT NULL DEFAULT 7 CHECK (measurement_days BETWEEN 1 AND 90),
  required_disclosure     BOOLEAN NOT NULL DEFAULT TRUE, -- #ad-style label in caption
  created_by              UUID NOT NULL REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The database itself refuses to let reservations exceed the budget.
  CONSTRAINT never_over_budget CHECK (reserved_paise <= budget_paise),
  CONSTRAINT never_over_quota  CHECK (active_submissions <= submission_quota),
  CONSTRAINT valid_dates       CHECK (expires_at > starts_at)
);
CREATE INDEX campaigns_status_idx ON campaigns (status, expires_at);

CREATE TABLE campaign_stores (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES stores(id),
  PRIMARY KEY (campaign_id, store_id)
);

-- ---------------------------------------------------------------------
-- Submissions and verification
-- ---------------------------------------------------------------------
CREATE TABLE submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES campaigns(id),
  store_id            UUID NOT NULL REFERENCES stores(id),
  influencer_id       UUID NOT NULL REFERENCES influencer_profiles(user_id),
  platform            TEXT NOT NULL CHECK (platform IN ('INSTAGRAM','YOUTUBE')),
  post_url            TEXT NOT NULL,
  platform_post_key   TEXT NOT NULL,   -- Instagram shortcode or YouTube video id
  platform_media_id   TEXT,            -- Instagram numeric media id, once resolved
  status              TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN (
                        'PENDING_VERIFICATION', -- waiting for the first API check
                        'MEASURING',            -- live; waiting out the measurement window
                        'RESTRICTED',           -- needs a human look (suspected bots, hidden metrics)
                        'REJECTED',             -- failed the quality gate or content review
                        'NOT_LIVE',             -- missing or deleted: zero pay
                        'APPROVED',             -- earned; waiting to enter a payment batch
                        'IN_BATCH',
                        'PAID',
                        'WITHDRAWN')),
  status_reason       TEXT,
  content_review      TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (content_review IN ('PENDING','APPROVED','REJECTED')),
  reviewed_by         UUID REFERENCES users(id),
  reserved_paise      BIGINT NOT NULL CHECK (reserved_paise >= 0),
  rate_snapshot       JSONB NOT NULL,  -- pay terms frozen at submission
  live_check_waived   BOOLEAN NOT NULL DEFAULT FALSE, -- admin override only; audited
  measure_due_at      TIMESTAMPTZ NOT NULL,
  last_live_check_at  TIMESTAMPTZ,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at         TIMESTAMPTZ
);
-- One post can only count once. A wrong link or withdrawn entry may be retried.
CREATE UNIQUE INDEX one_submission_per_post ON submissions (platform, platform_post_key)
  WHERE status NOT IN ('NOT_LIVE','WITHDRAWN');
CREATE INDEX submissions_due_idx ON submissions (status, measure_due_at);
CREATE INDEX submissions_store_idx ON submissions (store_id, status);
CREATE INDEX submissions_influencer_idx ON submissions (influencer_id, status);

-- Every call to Meta or YouTube leaves one row here.
CREATE TABLE social_link_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES submissions(id),
  purpose         TEXT NOT NULL CHECK (purpose IN ('INITIAL','SCHEDULED','FINAL','PRE_PAYOUT')),
  outcome         TEXT NOT NULL CHECK (outcome IN ('LIVE','NOT_FOUND','NOT_OWNER','API_ERROR')),
  detail          TEXT,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX verifications_submission_idx ON social_link_verifications (submission_id, checked_at DESC);

CREATE TABLE engagement_score_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id      UUID NOT NULL REFERENCES submissions(id),
  verification_id    UUID NOT NULL REFERENCES social_link_verifications(id),
  views              BIGINT NOT NULL,
  likes              BIGINT,  -- NULL means the platform hides it; never treated as zero
  comments           BIGINT,
  reach              BIGINT,
  followers          BIGINT,
  engagement_bps     INTEGER,
  gate_result        TEXT CHECK (gate_result IN ('PASS','FAIL','REVIEW')),
  gate_reasons       TEXT[] NOT NULL DEFAULT '{}',
  logged_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX engagement_submission_idx ON engagement_score_logs (submission_id, logged_at);

-- One earning per submission, created only when it clears every check.
CREATE TABLE earnings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       UUID NOT NULL REFERENCES submissions(id),
  influencer_id       UUID NOT NULL REFERENCES influencer_profiles(user_id),
  verification_id     UUID REFERENCES social_link_verifications(id),
  views_at_final      BIGINT NOT NULL,
  base_pay_paise      BIGINT NOT NULL,
  view_bonus_paise    BIGINT NOT NULL,
  multiplier_bps      INTEGER NOT NULL,
  gross_paise         BIGINT NOT NULL CHECK (gross_paise >= 0),
  payout_due_date     DATE NOT NULL,   -- 3 working days from approval
  status              TEXT NOT NULL DEFAULT 'PAYABLE'
                      CHECK (status IN ('PAYABLE','IN_BATCH','PAID','VOID')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_live_earning_per_submission ON earnings (submission_id) WHERE status <> 'VOID';
CREATE INDEX earnings_payable_idx ON earnings (status, payout_due_date);

-- ---------------------------------------------------------------------
-- Demo units
-- ---------------------------------------------------------------------
CREATE TABLE demo_units (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID NOT NULL REFERENCES stores(id),
  category_id    UUID NOT NULL REFERENCES product_categories(id),
  product_name   TEXT NOT NULL,
  serial_number  TEXT NOT NULL UNIQUE,
  value_paise    BIGINT NOT NULL CHECK (value_paise >= 0),
  status         TEXT NOT NULL DEFAULT 'AVAILABLE'
                 CHECK (status IN ('AVAILABLE','ON_LOAN','DAMAGED','LOST','RETIRED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE demo_unit_loans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_unit_id       UUID NOT NULL REFERENCES demo_units(id),
  influencer_id      UUID NOT NULL REFERENCES influencer_profiles(user_id),
  store_id           UUID NOT NULL REFERENCES stores(id),
  issued_by          UUID NOT NULL REFERENCES users(id),
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at             TIMESTAMPTZ NOT NULL,
  acknowledged_at    TIMESTAMPTZ,            -- creator confirmed receiving the unit
  returned_at        TIMESTAMPTZ,
  return_condition   TEXT CHECK (return_condition IN ('GOOD','DAMAGED','NOT_RETURNED')),
  liability_paise    BIGINT NOT NULL DEFAULT 0 CHECK (liability_paise >= 0),
  recovered_paise    BIGINT NOT NULL DEFAULT 0 CHECK (recovered_paise >= 0),
  liability_note     TEXT,
  assessed_by        UUID REFERENCES users(id),
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE','RETURNED','LIABILITY_OPEN','SETTLED')),
  CONSTRAINT recovery_within_liability CHECK (recovered_paise <= liability_paise)
);
CREATE UNIQUE INDEX one_active_loan_per_unit ON demo_unit_loans (demo_unit_id) WHERE status = 'ACTIVE';
CREATE INDEX loans_influencer_idx ON demo_unit_loans (influencer_id, status);

-- ---------------------------------------------------------------------
-- Paid ad rights (dark ads)
-- ---------------------------------------------------------------------
CREATE TABLE ad_whitelisting_rights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES submissions(id),
  influencer_id   UUID NOT NULL REFERENCES influencer_profiles(user_id),
  requested_by    UUID NOT NULL REFERENCES users(id),
  duration_days   INTEGER NOT NULL CHECK (duration_days IN (30,90)),
  status          TEXT NOT NULL DEFAULT 'REQUESTED'
                  CHECK (status IN ('REQUESTED','ACCEPTED','DECLINED','EXPIRED','REVOKED')),
  responded_at    TIMESTAMPTZ,
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_open_ad_right ON ad_whitelisting_rights (submission_id)
  WHERE status IN ('REQUESTED','ACCEPTED');

-- ---------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------
CREATE TABLE dispute_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id   UUID NOT NULL REFERENCES influencer_profiles(user_id),
  submission_id   UUID REFERENCES submissions(id),
  store_id        UUID REFERENCES stores(id),
  subject         TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN','RESOLVED_UPHELD','RESOLVED_DENIED')),
  resolution_note TEXT,
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX disputes_status_idx ON dispute_tickets (status, store_id);

-- ---------------------------------------------------------------------
-- Payment sheets
-- ---------------------------------------------------------------------
CREATE TABLE payment_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','APPROVED','RELEASING','RELEASED','CANCELLED')),
  generated_by    UUID REFERENCES users(id), -- NULL means the nightly job
  approved_by     UUID REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  prepared_by     UUID REFERENCES users(id),
  released_at     TIMESTAMPTZ,
  scheduled_for   DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT two_person_rule CHECK (approved_by IS NULL OR generated_by IS NULL OR approved_by <> generated_by)
);

CREATE TABLE payment_batch_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID NOT NULL REFERENCES payment_batches(id),
  earning_id          UUID NOT NULL REFERENCES earnings(id),
  influencer_id       UUID NOT NULL REFERENCES influencer_profiles(user_id),
  gross_paise         BIGINT NOT NULL,
  tds_paise           BIGINT NOT NULL CHECK (tds_paise >= 0),
  demo_deduction_paise BIGINT NOT NULL DEFAULT 0 CHECK (demo_deduction_paise >= 0),
  net_paise           BIGINT NOT NULL CHECK (net_paise >= 0),
  status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                        'PENDING','HELD','PROCESSING','PAID','FAILED','VOID')),
  status_reason       TEXT,
  utr                 TEXT,            -- bank reference, entered when marked paid
  paid_recorded_by    UUID REFERENCES users(id),
  exported_at         TIMESTAMPTZ,      -- when it went on a bank file
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT net_adds_up CHECK (net_paise = gross_paise - tds_paise - demo_deduction_paise)
);
CREATE UNIQUE INDEX one_live_item_per_earning ON payment_batch_items (earning_id)
  WHERE status IN ('PENDING','HELD','PROCESSING','PAID');
CREATE INDEX batch_items_batch_idx ON payment_batch_items (batch_id, status);

-- The tax ledger behind Form 26Q / TDS filing. Voided rows stay for history.
CREATE TABLE tds_ledger (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id      UUID NOT NULL REFERENCES influencer_profiles(user_id),
  batch_item_id      UUID NOT NULL UNIQUE REFERENCES payment_batch_items(id),
  tds_rule_id        UUID NOT NULL REFERENCES tds_rules(id),
  tax_year           TEXT NOT NULL,      -- e.g. '2026-27'
  gross_paise        BIGINT NOT NULL,
  tds_paise          BIGINT NOT NULL,
  rate_bps           INTEGER NOT NULL,
  pan_applied        BOOLEAN NOT NULL,
  pan_encrypted      TEXT,               -- the PAN as it stood on this payment
  is_void            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tds_ledger_year_idx ON tds_ledger (influencer_id, tax_year) WHERE NOT is_void;

CREATE TABLE demo_recoveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id         UUID NOT NULL REFERENCES demo_unit_loans(id),
  batch_item_id   UUID NOT NULL REFERENCES payment_batch_items(id),
  amount_paise    BIGINT NOT NULL CHECK (amount_paise > 0),
  is_void         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bank_holidays (
  holiday_date DATE PRIMARY KEY,
  name         TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- Promo codes and notifications
-- ---------------------------------------------------------------------
CREATE TABLE promo_codes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT NOT NULL UNIQUE,
  influencer_id  UUID NOT NULL REFERENCES influencer_profiles(user_id),
  campaign_id    UUID REFERENCES campaigns(id),
  store_id       UUID REFERENCES stores(id),
  redemptions    INTEGER NOT NULL DEFAULT 0,
  sales_paise    BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications_outbox (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  channel     TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL','WHATSAPP','SMS')),
  template    TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);

CREATE TABLE password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id),   -- NULL means the person asked by email
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Store visit booking
-- ---------------------------------------------------------------------
CREATE TABLE store_visit_windows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  weekday       INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time    TEXT NOT NULL CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time      TEXT NOT NULL CHECK (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  slot_minutes  INTEGER NOT NULL CHECK (slot_minutes IN (30,60)),
  capacity      INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  CONSTRAINT window_order CHECK (start_time < end_time)
);
CREATE INDEX visit_windows_store_idx ON store_visit_windows (store_id, weekday);

CREATE TABLE store_visit_closures (
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  closed_date  DATE NOT NULL,
  reason       TEXT NOT NULL,
  PRIMARY KEY (store_id, closed_date)
);

CREATE TABLE store_visits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID NOT NULL REFERENCES stores(id),
  influencer_id  UUID NOT NULL REFERENCES influencer_profiles(user_id),
  campaign_id    UUID REFERENCES campaigns(id),
  slot_start     TIMESTAMPTZ NOT NULL,
  slot_end       TIMESTAMPTZ NOT NULL,
  purpose        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN
                 ('REQUESTED','APPROVED','DECLINED','CANCELLED','EXPIRED','COMPLETED','NO_SHOW')),
  decision_note  TEXT,
  decided_by     UUID REFERENCES users(id),
  decided_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX store_visits_store_idx ON store_visits (store_id, slot_start, status);
CREATE UNIQUE INDEX one_visit_per_creator_slot ON store_visits (influencer_id, slot_start)
  WHERE status IN ('REQUESTED','APPROVED');

CREATE TABLE auth_attempts (
  id        BIGSERIAL PRIMARY KEY,
  key       TEXT NOT NULL,   -- hashed email or IP
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_attempts_idx ON auth_attempts (key, at);

-- ---------------------------------------------------------------------
-- Audit log. Append-only: the database rejects edits and deletes.
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  actor_id     UUID REFERENCES users(id),  -- NULL means the system
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  reason       TEXT,
  details      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_logs (entity_type, entity_id);

CREATE FUNCTION forbid_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();

-- ---------------------------------------------------------------------
-- Zero-pay rule, enforced by the database as a last line of defence.
-- Even if application code had a bug, an item cannot move to PROCESSING
-- or PAID unless a LIVE check from the last 24 hours exists, or an admin
-- recorded an audited waiver.
-- ---------------------------------------------------------------------
CREATE FUNCTION enforce_zero_pay_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sub_id UUID;
  waived BOOLEAN;
BEGIN
  IF NEW.status IN ('PROCESSING','PAID') AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status <> 'PROCESSING' THEN
    SELECT s.id, s.live_check_waived INTO sub_id, waived
      FROM earnings e JOIN submissions s ON s.id = e.submission_id
     WHERE e.id = NEW.earning_id;
    IF NOT waived AND NOT EXISTS (
      SELECT 1 FROM social_link_verifications v
       WHERE v.submission_id = sub_id AND v.outcome = 'LIVE'
         AND v.checked_at > now() - INTERVAL '24 hours') THEN
      RAISE EXCEPTION 'zero-pay rule: no live verification in the last 24 hours for submission %', sub_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER batch_items_zero_pay BEFORE UPDATE ON payment_batch_items
  FOR EACH ROW EXECUTE FUNCTION enforce_zero_pay_rule();

-- Starting data. Every value here can be edited later from the admin panel.
-- Pay figures are illustrative defaults: replace them with your real rates.

INSERT INTO tiers (name, rank, min_avg_views, min_engagement_bps) VALUES
  ('Nano',  1,      0,   0),
  ('Micro', 2,  10000, 150),
  ('Mid',   3,  50000, 200),
  ('Macro', 4, 250000, 200)
ON CONFLICT (name) DO NOTHING;

INSERT INTO rate_cards (tier_id, base_pay_paise, bonus_per_10k_paise, max_view_bonus_paise)
SELECT t.id, v.base, v.bonus, v.cap
FROM (VALUES
  ('Nano',   100000,  20000,   200000),
  ('Micro',  300000,  30000,   600000),
  ('Mid',   1000000,  50000,  2000000),
  ('Macro', 3000000, 100000,  6000000)
) AS v(name, base, bonus, cap)
JOIN tiers t ON t.name = v.name
ON CONFLICT (tier_id) DO NOTHING;

INSERT INTO product_categories (name, multiplier_bps) VALUES
  ('Mobiles',          10000),
  ('Laptops',          12500),
  ('TVs',              15000),
  ('ACs',              15000),
  ('Refrigerators',    15000),
  ('Washing Machines', 12500),
  ('Air Fryers',       10000),
  ('Robot Vacuums',    12500)
ON CONFLICT (name) DO NOTHING;

-- Default assumes professional fees (old section 194J, now section 393 of the
-- Income-tax Act 2025). Have your CA confirm this classification before launch.
INSERT INTO tds_rules (label, legacy_section, rate_bps, no_pan_rate_bps, annual_threshold_paise, effective_from)
VALUES ('Professional fees, resident', '194J', 1000, 2000, 5000000, '2026-04-01')
ON CONFLICT (effective_from) DO NOTHING;

INSERT INTO legal_documents (version, title, body, content_hash, is_current)
SELECT 'DRAFT-1', 'Creator Terms & Conditions', b.body, encode(digest(b.body, 'sha256'), 'hex'), TRUE
FROM (SELECT $terms$DRAFT: must be reviewed by your lawyer before use with real creators.

In these Terms, the Company means Lotus Electronics Supermarket [REGISTERED LEGAL NAME TO BE CONFIRMED BY YOUR LAWYER].

1. Intellectual property. On payment for a submission, the Creator assigns to the Company all copyright and related rights in the media created for that submission, for all media, worldwide, for the full term of copyright. The Creator confirms the media is original and that music, people and other material in it are properly licensed or consented to.

2. Brand guidelines. The Creator will follow the campaign brief and the Company's brand guidelines, and will clearly label sponsored content as an advertisement as required by applicable advertising rules.

3. Payment conditions. Payment is due only if the post is live on the Creator's own account, passes the published engagement checks and remains live through the measurement period. A post that is never published or is deleted earns no payment.

4. Tax. The Company will deduct tax at source as required by law. The Creator is responsible for their own tax filings and for accurate PAN and GST details.

5. Demo units. Loaned products remain Company property and must be returned by the due date in the condition received, normal use excepted. The Creator authorises the Company to withhold payment, and to set off the assessed repair or replacement value against amounts owed, if a product is damaged or not returned.

6. Paid ad rights. The Company may request permission to run a post as a paid advertisement for 30 or 90 days. These rights begin only when the Creator accepts the request.

7. Liability. The Creator is responsible for the lawfulness of their content and for their own conduct while creating it. To the extent permitted by law, the Company is not liable for indirect losses arising from the Creator's participation.

8. Non-disparagement. While participating and for 12 months afterwards, the Creator will not publish false or misleading statements about the Company. This does not limit honest opinions, truthful statements or any legal rights.

9. Disputes. Disputes will first go through the platform's dispute desk. These Terms are governed by the laws of India, with exclusive jurisdiction in the courts of [CITY TO BE CONFIRMED BY YOUR LAWYER].
$terms$ AS body) b
ON CONFLICT (version) DO NOTHING;
