-- One paid entry per creator per campaign. A post that ended with no pay (not found, withdrawn
-- or rejected) frees the creator to try again; anything still in progress or paid blocks a second one.
CREATE OR REPLACE FUNCTION one_entry_per_campaign() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('NOT_LIVE','WITHDRAWN','REJECTED') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id::text || NEW.influencer_id::text, 7));
  IF EXISTS (SELECT 1 FROM submissions s WHERE s.campaign_id = NEW.campaign_id AND s.influencer_id = NEW.influencer_id
               AND s.id <> NEW.id AND s.status NOT IN ('NOT_LIVE','WITHDRAWN','REJECTED')) THEN
    RAISE EXCEPTION 'ONE_ENTRY_PER_CAMPAIGN';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submissions_one_entry BEFORE INSERT OR UPDATE OF status ON submissions
  FOR EACH ROW EXECUTE FUNCTION one_entry_per_campaign();

-- Second lock at the money: a creator can hold only one live earning per campaign.
CREATE OR REPLACE FUNCTION one_earning_per_campaign() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE camp UUID;
BEGIN
  IF NEW.status = 'VOID' THEN RETURN NEW; END IF;
  SELECT campaign_id INTO camp FROM submissions WHERE id = NEW.submission_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(camp::text || NEW.influencer_id::text, 7));
  IF EXISTS (SELECT 1 FROM earnings e JOIN submissions s ON s.id = e.submission_id
              WHERE s.campaign_id = camp AND e.influencer_id = NEW.influencer_id AND e.id <> NEW.id AND e.status <> 'VOID') THEN
    RAISE EXCEPTION 'ONE_PAYMENT_PER_CAMPAIGN';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER earnings_one_per_campaign BEFORE INSERT OR UPDATE OF status ON earnings
  FOR EACH ROW EXECUTE FUNCTION one_earning_per_campaign();

ALTER TABLE payout_accounts ADD COLUMN account_lookup_hash TEXT UNIQUE;
