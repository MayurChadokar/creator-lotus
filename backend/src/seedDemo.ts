import bcrypt from 'bcryptjs';
import { encrypt, lookupHash, pool, withTx } from './core.js';
import { setupDatabase } from './dbSetup.js';

// Repeatable sample data for product demos. Fixed IDs keep every insert idempotent.
const ID = {
  storeIndore: '10000000-0000-4000-8000-000000000001',
  storeBhopal: '10000000-0000-4000-8000-000000000002',
  manager: '20000000-0000-4000-8000-000000000001',
  creator: '20000000-0000-4000-8000-000000000002',
  socialIg: '30000000-0000-4000-8000-000000000001',
  socialYt: '30000000-0000-4000-8000-000000000002',
  campaignOpen: '40000000-0000-4000-8000-000000000001',
  campaignUpcoming: '40000000-0000-4000-8000-000000000002',
  campaignPast: '40000000-0000-4000-8000-000000000003',
  submissionPaid: '50000000-0000-4000-8000-000000000001',
  submissionMeasuring: '50000000-0000-4000-8000-000000000002',
  earningPaid: '60000000-0000-4000-8000-000000000001',
  visitComplete: '70000000-0000-4000-8000-000000000001',
  visitUpcoming: '70000000-0000-4000-8000-000000000002',
  batch: '80000000-0000-4000-8000-000000000001',
  batchItem: '80000000-0000-4000-8000-000000000002',
  promo: '90000000-0000-4000-8000-000000000001',
};

async function main() {
  await setupDatabase();
  const passwordHash = await bcrypt.hash('Sample-Test-2026', 12);

  await withTx(async (db) => {
    const admins = await db.query<{ id: string }>(`SELECT id FROM users WHERE role='ADMIN' AND is_active=TRUE ORDER BY created_at LIMIT 1`);
    if (!admins.rows[0]) throw new Error('Run db:setup with FIRST_ADMIN_EMAIL and FIRST_ADMIN_PASSWORD before db:demo.');
    const adminId = admins.rows[0].id;

    await db.query(`INSERT IGNORE INTO stores (id,code,name,city,state,latitude,longitude,is_active) VALUES
      ($1,'SAMPLE-INDORE','Lotus Electronics - Vijay Nagar','Indore','Madhya Pradesh',22.7533,75.8937,TRUE),
      ($2,'SAMPLE-BHOPAL','Lotus Electronics - MP Nagar','Bhopal','Madhya Pradesh',23.2334,77.4346,TRUE)`,
      [ID.storeIndore, ID.storeBhopal]);

    await db.query(`INSERT IGNORE INTO users (id,role,full_name,email,phone,password_hash,store_id,is_active,must_change_password) VALUES
      ($1,'STORE_MANAGER','SAMPLE Store Manager','manager@lotuselectronics.com','9000000011',$3,$4,TRUE,FALSE),
      ($2,'INFLUENCER','SAMPLE Creator','creator@lotuselectronics.com','9000000022',$3,NULL,TRUE,FALSE)`,
      [ID.manager, ID.creator, passwordHash, ID.storeIndore]);
    await db.query(`UPDATE users SET password_hash=$1,is_active=TRUE,must_change_password=FALSE,token_version=token_version+1
      WHERE email IN ('manager@lotuselectronics.com','creator@lotuselectronics.com')`, [passwordHash]);

    const creators = await db.query<{ id: string }>(`SELECT id FROM users WHERE email='creator@lotuselectronics.com' LIMIT 1`);
    const managers = await db.query<{ id: string }>(`SELECT id FROM users WHERE email='manager@lotuselectronics.com' LIMIT 1`);
    const creatorId = creators.rows[0]?.id;
    const managerId = managers.rows[0]?.id;
    if (!creatorId || !managerId) throw new Error('Demo panel users could not be created.');

    const tiers = await db.query<{ id: string }>(`SELECT id FROM tiers WHERE name='Micro' LIMIT 1`);
    const categories = await db.query<{ id: string; name: string }>(`SELECT id,name FROM product_categories WHERE name IN ('Mobiles','TVs','Laptops')`);
    const tierId = tiers.rows[0]!.id;
    const category = (name: string) => categories.rows.find((x) => x.name === name)!.id;

    await db.query(`INSERT IGNORE INTO influencer_profiles
      (user_id,tier_id,city,latitude,longitude,vetting_status,home_store_id,vetting_step1_by,privacy_accepted_at)
      VALUES ($1,$2,'Indore',22.7533,75.8937,'APPROVED',$3,$4,NOW())`,
      [creatorId, tierId, ID.storeIndore, managerId]);

    await db.query(`INSERT IGNORE INTO social_accounts (id,influencer_id,platform,external_id,handle,followers) VALUES
      ($1,$3,'INSTAGRAM','sample-lotus-creator-ig','lotus.creator.demo',24800),
      ($2,$3,'YOUTUBE','sample-lotus-creator-yt','LotusCreatorDemo',12600)`,
      [ID.socialIg, ID.socialYt, creatorId]);

    const pan = 'ABCDE1234F';
    const account = '123456789012';
    await db.query(`INSERT IGNORE INTO tax_records
      (influencer_id,pan_encrypted,pan_lookup_hash,pan_last4,legal_name,pan_status,gstin)
      VALUES ($1,$2,$3,'1234','Sample Creator','VERIFIED','23ABCDE1234F1Z5')`,
      [creatorId, encrypt(pan), lookupHash(pan)]);
    await db.query(`INSERT IGNORE INTO payout_accounts
      (influencer_id,account_type,account_holder,account_number_enc,ifsc,masked_display,account_lookup_hash,verified_at,verified_by)
      VALUES ($1,'BANK','Sample Creator',$2,'HDFC0001234','HDFC •••• 9012',$3,NOW(),$4)`,
      [creatorId, encrypt(account), lookupHash(account), adminId]);

    const legal = await db.query<{ id: string; content_hash: string }>(`SELECT id,content_hash FROM legal_documents WHERE is_current=TRUE ORDER BY published_at DESC LIMIT 1`);
    if (legal.rows[0]) await db.query(`INSERT IGNORE INTO legal_acceptance_logs
      (influencer_id,document_id,content_hash,ip_address,user_agent) VALUES ($1,$2,$3,'127.0.0.1','Lotus sample data')`,
      [creatorId, legal.rows[0].id, legal.rows[0].content_hash]);

    await db.query(`INSERT IGNORE INTO campaigns
      (id,title,brief,category_id,status,starts_at,expires_at,budget_paise,reserved_paise,submission_quota,active_submissions,min_engagement_bps,min_views,measurement_days,posting_hashtags,posting_mentions,posting_guidelines,collab_account,created_by)
      VALUES
      ($1,'SAMPLE Smartphone Launch','Create a premium reel showing the camera, display and everyday performance of our latest smartphone range.',$4,'OPEN','2026-11-01','2027-02-28',50000000,350000,40,1,150,1000,7,JSON_ARRAY('LotusElectronics','LotusCreator'),JSON_ARRAY('lotuselectronics'),'Film inside the approved Lotus store and clearly show the product.','lotuselectronics',$7),
      ($2,'SAMPLE Smart TV Festival','Show how a big-screen Lotus shopping experience transforms family entertainment.',$5,'PAUSED','2026-12-01','2027-03-31',75000000,0,50,0,175,1500,7,JSON_ARRAY('LotusTVFestival','Ad'),JSON_ARRAY('lotuselectronics'),'Keep the video family-friendly and feature the in-store demo.','lotuselectronics',$7),
      ($3,'SAMPLE Laptop Back-to-College','A completed sample campaign demonstrating historical creator earnings.',$6,'CLOSED','2026-07-01','2026-09-30',30000000,0,25,0,150,800,7,JSON_ARRAY('LotusLaptops','Ad'),JSON_ARRAY('lotuselectronics'),'Highlight productivity and student offers.','lotuselectronics',$7)`,
      [ID.campaignOpen, ID.campaignUpcoming, ID.campaignPast, category('Mobiles'), category('TVs'), category('Laptops'), adminId]);

    for (const campaignId of [ID.campaignOpen, ID.campaignUpcoming, ID.campaignPast]) {
      await db.query(`INSERT IGNORE INTO campaign_stores (campaign_id,store_id) VALUES ($1,$2),($1,$3)`, [campaignId, ID.storeIndore, ID.storeBhopal]);
    }

    await db.query(`INSERT INTO submissions
      (id,campaign_id,store_id,influencer_id,platform,post_url,platform_post_key,status,content_review,reviewed_by,reserved_paise,rate_snapshot,live_check_waived,measure_due_at,last_live_check_at,submitted_at,approved_at,gate_min_views,gate_min_engagement_bps,collab_confirmed,shared_at,shared_by)
      SELECT $1,$2,$3,$4,'INSTAGRAM','https://www.instagram.com/reel/SAMPLEPAID/','SAMPLEPAID','PAID','APPROVED',$5,0,$6,TRUE,'2026-08-22','2026-08-22','2026-08-14','2026-08-22',800,150,TRUE,'2026-08-23',$5
      WHERE NOT EXISTS (SELECT 1 FROM submissions WHERE id=$1)`,
      [ID.submissionPaid, ID.campaignPast, ID.storeIndore, creatorId, adminId,
        JSON.stringify({ basePayPaise: 300000, bonusPer10kPaise: 30000, maxViewBonusPaise: 600000, multiplierBps: 12500 })]);
    await db.query(`INSERT INTO submissions
      (id,campaign_id,store_id,influencer_id,platform,post_url,platform_post_key,status,content_review,reviewed_by,reserved_paise,rate_snapshot,live_check_waived,measure_due_at,last_live_check_at,submitted_at,approved_at,gate_min_views,gate_min_engagement_bps,collab_confirmed,shared_at,shared_by)
      SELECT $1,$2,$3,$4,'YOUTUBE','https://www.youtube.com/watch?v=SAMPLEVIEW1','SAMPLEVIEW1','MEASURING','APPROVED',$5,350000,$6,TRUE,'2026-11-25',NOW(),NOW(),NULL,1000,150,TRUE,NULL,NULL
      WHERE NOT EXISTS (SELECT 1 FROM submissions WHERE id=$1)`,
      [ID.submissionMeasuring, ID.campaignOpen, ID.storeIndore, creatorId, adminId,
        JSON.stringify({ basePayPaise: 300000, bonusPer10kPaise: 30000, maxViewBonusPaise: 600000, multiplierBps: 10000 })]);

    await db.query(`INSERT INTO earnings
      (id,submission_id,influencer_id,views_at_final,base_pay_paise,view_bonus_paise,multiplier_bps,gross_paise,payout_due_date,status)
      SELECT $1,$2,$3,58400,300000,150000,12500,562500,'2026-08-27','PAID'
      WHERE NOT EXISTS (SELECT 1 FROM earnings WHERE id=$1)`,
      [ID.earningPaid, ID.submissionPaid, creatorId]);
    await db.query(`INSERT IGNORE INTO payment_batches
      (id,reference,status,generated_by,approved_by,approved_at,prepared_by,released_at,scheduled_for)
      VALUES ($1,'SAMPLE-PAY-2026-08','RELEASED',$2,$2,'2026-08-25',$2,'2026-08-27','2026-08-27')`, [ID.batch, adminId]);
    await db.query(`INSERT INTO payment_batch_items
      (id,batch_id,earning_id,influencer_id,gross_paise,tds_paise,benefit_tds_paise,net_paise,status,utr,paid_recorded_by,exported_at,paid_at)
      SELECT $1,$2,$3,$4,562500,56250,0,506250,'PAID','SAMPLEUTR20260827',$5,'2026-08-27','2026-08-27'
      WHERE NOT EXISTS (SELECT 1 FROM payment_batch_items WHERE id=$1)`,
      [ID.batchItem, ID.batch, ID.earningPaid, creatorId, adminId]);

    for (const [weekday, start, end, capacity] of [[1, '11:00', '17:00', 3], [3, '11:00', '17:00', 3], [6, '12:00', '18:00', 4]] as const) {
      await db.query(`INSERT INTO store_visit_windows (id,store_id,weekday,start_time,end_time,slot_minutes,capacity)
        SELECT UUID(),$1,$2,$3,$4,60,$5 WHERE NOT EXISTS
        (SELECT 1 FROM store_visit_windows WHERE store_id=$1 AND weekday=$2 AND start_time=$3 AND end_time=$4 AND slot_minutes=60)`,
        [ID.storeIndore, weekday, start, end, capacity]);
    }
    await db.query(`INSERT INTO store_visits
      (id,store_id,influencer_id,campaign_id,slot_start,slot_end,purpose,status,decision_note,decided_by,decided_at)
      SELECT $1,$2,$3,$4,'2026-08-12 06:30:00','2026-08-12 07:30:00','Film laptop campaign content','COMPLETED','Visit completed successfully',$5,'2026-08-10'
      WHERE NOT EXISTS (SELECT 1 FROM store_visits WHERE id=$1)`,
      [ID.visitComplete, ID.storeIndore, creatorId, ID.campaignPast, managerId]);
    await db.query(`INSERT INTO store_visits
      (id,store_id,influencer_id,campaign_id,slot_start,slot_end,purpose,status,decision_note,decided_by,decided_at)
      SELECT $1,$2,$3,$4,'2026-11-28 06:30:00','2026-11-28 07:30:00','Film smartphone launch reel','APPROVED','Store team is ready for the creator',$5,NOW()
      WHERE NOT EXISTS (SELECT 1 FROM store_visits WHERE id=$1)`,
      [ID.visitUpcoming, ID.storeIndore, creatorId, ID.campaignOpen, managerId]);
    await db.query(`INSERT IGNORE INTO promo_codes (id,code,influencer_id,campaign_id,store_id,redemptions,sales_paise)
      VALUES ($1,'SAMPLELOTUS10',$2,$3,$4,18,4860000)`, [ID.promo, creatorId, ID.campaignOpen, ID.storeIndore]);

    for (const [date, name] of [['2026-12-25', 'Christmas'], ['2027-01-26', 'Republic Day'], ['2027-03-08', 'Holi']]) {
      await db.query(`INSERT IGNORE INTO bank_holidays (holiday_date,name) VALUES ($1,$2)`, [date, name]);
    }
  });

  console.log('Full SAMPLE dataset is ready. Login: creator@lotuselectronics.com / Sample-Test-2026');
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
