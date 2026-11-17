-- Posting specs: hashtags, mentions and caption instructions per campaign.
ALTER TABLE campaigns ADD COLUMN posting_hashtags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN posting_mentions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN posting_guidelines TEXT;
UPDATE campaigns SET posting_hashtags = '{#LotusElectronics,#LotusDiwali}', posting_mentions = '{@lotuselectronics}',
  posting_guidelines = 'Mention the festive offer and the store name in the first line. Keep the caption in Hindi or English.'
 WHERE title = 'SAMPLE Diwali TV reviews';
