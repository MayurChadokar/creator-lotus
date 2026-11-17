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

-- TDS rules for tax year 2026-27. Old section numbers are shown because they are the familiar ones;
-- these now sit under section 393 of the Income-tax Act 2025. Have your CA confirm before launch.
INSERT INTO tds_rules (code, label, legacy_section, rate_bps, no_pan_rate_bps, annual_threshold_paise, single_threshold_paise, effective_from) VALUES
  ('PROF_194J',           'Professional or content creation fees',  '194J', 1000, 2000, 5000000, NULL,    '2026-04-01'),
  ('CONTRACT_194C_IND',   'Contract work, individual or HUF',       '194C',  100, 2000, 10000000, 3000000, '2026-04-01'),
  ('CONTRACT_194C_OTHER', 'Contract work, company or firm',         '194C',  200, 2000, 10000000, 3000000, '2026-04-01'),
  ('BENEFIT_194R',        'Free products, gifts, travel, experiences', '194R', 1000, 2000, 2000000, NULL,  '2026-04-01')
ON CONFLICT (code, effective_from) DO NOTHING;

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
$terms$ AS body) b
ON CONFLICT (version) DO NOTHING;
