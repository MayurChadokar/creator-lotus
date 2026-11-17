-- MySQL 8 seed data. INSERT IGNORE makes setup safely repeatable.
INSERT IGNORE INTO tiers (name, `rank`, min_avg_views, min_engagement_bps) VALUES
  ('Nano',1,0,0), ('Micro',2,10000,150), ('Mid',3,50000,200), ('Macro',4,250000,200);

INSERT IGNORE INTO rate_cards (tier_id,base_pay_paise,bonus_per_10k_paise,max_view_bonus_paise)
SELECT id,
  CASE name WHEN 'Nano' THEN 100000 WHEN 'Micro' THEN 300000 WHEN 'Mid' THEN 1000000 ELSE 3000000 END,
  CASE name WHEN 'Nano' THEN 20000 WHEN 'Micro' THEN 30000 WHEN 'Mid' THEN 50000 ELSE 100000 END,
  CASE name WHEN 'Nano' THEN 200000 WHEN 'Micro' THEN 600000 WHEN 'Mid' THEN 2000000 ELSE 6000000 END
FROM tiers WHERE name IN ('Nano','Micro','Mid','Macro');

INSERT IGNORE INTO product_categories (name,multiplier_bps) VALUES
  ('Mobiles',10000), ('Laptops',12500), ('TVs',15000), ('ACs',15000),
  ('Refrigerators',15000), ('Washing Machines',12500), ('Air Fryers',10000), ('Robot Vacuums',12500);

INSERT IGNORE INTO tds_rules
  (code,label,legacy_section,rate_bps,no_pan_rate_bps,annual_threshold_paise,single_threshold_paise,effective_from) VALUES
  ('PROF_194J','Professional or content creation fees','194J',1000,2000,5000000,NULL,'2026-04-01'),
  ('CONTRACT_194C_IND','Contract work, individual or HUF','194C',100,2000,10000000,3000000,'2026-04-01'),
  ('CONTRACT_194C_OTHER','Contract work, company or firm','194C',200,2000,10000000,3000000,'2026-04-01'),
  ('BENEFIT_194R','Free products, gifts, travel, experiences','194R',1000,2000,2000000,NULL,'2026-04-01');

INSERT IGNORE INTO legal_documents (version,title,body,content_hash,is_current) VALUES
('DRAFT-2','Creator Terms & Conditions',
'DRAFT: must be reviewed by your lawyer before use with real creators. In these Terms, the Company means Lotus Electronics Supermarket. Creators must follow campaign briefs, advertising disclosure rules, content licensing requirements, payment verification conditions and applicable Indian tax requirements. Products for in-store demos may not be removed. Paid-ad rights begin only after creator acceptance. Disputes first go through the platform dispute desk.',
SHA2('DRAFT-2 Creator Terms & Conditions',256),1);
