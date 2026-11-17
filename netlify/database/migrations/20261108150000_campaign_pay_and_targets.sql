CREATE TABLE campaign_rate_cards (   -- pay for one campaign by creator level; replaces the standard rate and multiplier
  campaign_id          UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  tier_id              UUID NOT NULL REFERENCES tiers(id),
  base_pay_paise       BIGINT NOT NULL CHECK (base_pay_paise >= 0),
  bonus_per_10k_paise  BIGINT NOT NULL CHECK (bonus_per_10k_paise >= 0),
  max_view_bonus_paise BIGINT NOT NULL CHECK (max_view_bonus_paise >= 0),
  PRIMARY KEY (campaign_id, tier_id)
);

ALTER TABLE submissions ADD COLUMN gate_min_views INTEGER;
ALTER TABLE submissions ADD COLUMN gate_min_engagement_bps INTEGER;
-- Freeze the current targets on posts already in progress.
UPDATE submissions s SET gate_min_views = k.min_views, gate_min_engagement_bps = k.min_engagement_bps
  FROM campaigns k WHERE k.id = s.campaign_id;
