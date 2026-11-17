-- MySQL equivalents for the PostgreSQL safety triggers.
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit_logs is append-only';
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit_logs is append-only';

CREATE TRIGGER batch_items_zero_pay BEFORE UPDATE ON payment_batch_items
FOR EACH ROW
BEGIN
  DECLARE sub_id CHAR(36);
  DECLARE waived TINYINT(1);
  IF NEW.status IN ('PROCESSING','PAID') AND NOT (OLD.status <=> NEW.status) AND OLD.status <> 'PROCESSING' THEN
    SELECT s.id,s.live_check_waived INTO sub_id,waived
      FROM earnings e JOIN submissions s ON s.id=e.submission_id WHERE e.id=NEW.earning_id;
    IF waived=0 AND NOT EXISTS (
      SELECT 1 FROM social_link_verifications v
       WHERE v.submission_id=sub_id AND v.outcome='LIVE' AND v.checked_at>DATE_SUB(NOW(),INTERVAL 24 HOUR)
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='zero-pay rule: no recent live verification';
    END IF;
  END IF;
END;

CREATE TRIGGER submissions_one_entry_insert BEFORE INSERT ON submissions
FOR EACH ROW
BEGIN
  IF NEW.status NOT IN ('NOT_LIVE','WITHDRAWN','REJECTED') AND EXISTS (
    SELECT 1 FROM submissions s WHERE s.campaign_id=NEW.campaign_id AND s.influencer_id=NEW.influencer_id
      AND s.status NOT IN ('NOT_LIVE','WITHDRAWN','REJECTED')
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ONE_ENTRY_PER_CAMPAIGN'; END IF;
END;
CREATE TRIGGER submissions_one_entry_update BEFORE UPDATE ON submissions
FOR EACH ROW
BEGIN
  IF NEW.status NOT IN ('NOT_LIVE','WITHDRAWN','REJECTED') AND EXISTS (
    SELECT 1 FROM submissions s WHERE s.campaign_id=NEW.campaign_id AND s.influencer_id=NEW.influencer_id
      AND s.id<>NEW.id AND s.status NOT IN ('NOT_LIVE','WITHDRAWN','REJECTED')
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ONE_ENTRY_PER_CAMPAIGN'; END IF;
END;

CREATE TRIGGER earnings_one_per_campaign_insert BEFORE INSERT ON earnings
FOR EACH ROW
BEGIN
  DECLARE camp CHAR(36);
  SELECT campaign_id INTO camp FROM submissions WHERE id=NEW.submission_id;
  IF NEW.status<>'VOID' AND EXISTS (
    SELECT 1 FROM earnings e JOIN submissions s ON s.id=e.submission_id
     WHERE s.campaign_id=camp AND e.influencer_id=NEW.influencer_id AND e.status<>'VOID'
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ONE_PAYMENT_PER_CAMPAIGN'; END IF;
END;
