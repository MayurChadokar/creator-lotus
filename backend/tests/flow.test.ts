// Whole journeys against a real PostgreSQL database.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/core.js';
import { setCampaignStatus } from '../src/engines/budget.js';
import { availableSlots, decideVisit, MIN_NOTICE_HOURS, recordOutcome, requestVisit, saveWindows } from '../src/engines/visits.js';
import { reviewTiers, runJobs } from '../src/engines/jobs.js';
import { overrideSubmission, raiseDispute, resolveDispute } from '../src/engines/liability.js';
import { approveBatch, bankPaymentLines, batchCsv, generateBatch, recordBankFailed, recordBankPaid, releaseBatch } from '../src/engines/payouts.js';
import { checkSubmission, createSubmission, finalizeSubmission, reviewContent } from '../src/engines/verification.js';
import { campaign, categoryId, live, makeCampaign, makeCreator, makeDue, makeStore, makeUser, newPostUrl, posts, q1, resetDb, sub } from './helpers.js';

let store: string, admin: string, admin2: string, manager: string;
// Nano creator on a TV campaign: base Rs 1,000; reservation (1000+2000) x 1.5 = Rs 4,500
const NANO_RESERVE = 450000;

before(async () => {
  process.env.JOBS_SECRET = 'jobs'; process.env.JWT_SECRET = 'x'.repeat(40);
  await resetDb();
  store = await makeStore(); admin = await makeUser('ADMIN'); admin2 = await makeUser('ADMIN'); manager = await makeUser('STORE_MANAGER', store);
});
after(() => pool.end());

const mgr = () => ({ id: manager, role: 'STORE_MANAGER', storeId: store });
const adm = () => ({ id: admin, role: 'ADMIN', storeId: null });

async function submit(creator: string, camp: string, check = live(25000, 900, 100)) {
  // A creator gets one paid entry per campaign, so tests that pile up several earnings for one creator
  // move each extra post into a fresh copy of the campaign.
  if (await q1(`SELECT 1 FROM submissions WHERE campaign_id=$1 AND influencer_id=$2 AND status NOT IN ('NOT_LIVE','WITHDRAWN','REJECTED')`, [camp, creator]))
    camp = await makeCampaign(store, admin);
  const p = newPostUrl(); posts.set(p.key, check);
  const id = await createSubmission({ influencerId: creator, campaignId: camp, storeId: store, postUrl: p.url });
  return { id, key: p.key };
}
async function approved(creator: string, camp: string, check = live(25000, 900, 100)) {
  const s = await submit(creator, camp, check);
  await reviewContent(s.id, adm(), 'APPROVED');
  await makeDue(s.id);
  assert.equal(await finalizeSubmission(s.id), 'APPROVED');
  return s;
}
/** Clears any earnings left in the queue by other tests. */
const clearQueue = () => pool.query(`UPDATE earnings SET status='VOID' WHERE status='PAYABLE'`);

test('Budget: 20 creators at once on a budget for 5 gives exactly 5, then it locks', async () => {
  const camp = await makeCampaign(store, admin, { budget: NANO_RESERVE * 5 });
  const creators = await Promise.all(Array.from({ length: 20 }, () => makeCreator(store)));
  const results = await Promise.allSettled(creators.map((c) => submit(c, camp)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
  const k = await campaign(camp);
  assert.equal(k.reserved_paise, NANO_RESERVE * 5);
  assert.equal(k.status, 'LOCKED'); assert.equal(k.lock_reason, 'BUDGET');
});
test('Quota: locks at the limit, and a rejection reopens it', async () => {
  const camp = await makeCampaign(store, admin, { quota: 2 });
  const a = await submit(await makeCreator(store), camp);
  await submit(await makeCreator(store), camp);
  assert.equal((await campaign(camp)).lock_reason, 'QUOTA');
  await assert.rejects(submit(await makeCreator(store), camp), /locked/);
  await reviewContent(a.id, adm(), 'REJECTED', 'Wrong product shown');
  const k = await campaign(camp);
  assert.equal(k.status, 'OPEN'); assert.equal(k.active_submissions, 1); assert.equal(k.reserved_paise, NANO_RESERVE);
});
test('Lifecycle: paused or closed campaigns refuse submissions; closed stays closed', async () => {
  const camp = await makeCampaign(store, admin);
  await setCampaignStatus(camp, 'PAUSED', admin);
  await assert.rejects(submit(await makeCreator(store), camp), /paused/);
  await setCampaignStatus(camp, 'CLOSED', admin);
  await assert.rejects(setCampaignStatus(camp, 'OPEN', admin), /Cannot move/);
});
test('Duplicate: the same post cannot be submitted twice', async () => {
  const c = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await submit(c, camp);
  await assert.rejects(createSubmission({ influencerId: c, campaignId: camp, storeId: store, postUrl: `https://instagram.com/p/${s.key}/` }), /already been submitted/);
});
test('Legal gate: no accepted terms, no submission', async () => {
  const c = await makeCreator(store); const camp = await makeCampaign(store, admin);
  await pool.query(`DELETE FROM legal_acceptance_logs WHERE influencer_id=$1`, [c]);
  await assert.rejects(submit(c, camp), /Terms/);
});
test('Blacklisted creators cannot submit', async () => {
  const c = await makeCreator(store); const camp = await makeCampaign(store, admin);
  await pool.query(`UPDATE influencer_profiles SET is_blacklisted=TRUE WHERE user_id=$1`, [c]);
  await assert.rejects(submit(c, camp), /cannot take part/);
});
test('Zero pay: post never published ends NOT_LIVE and returns the budget', async () => {
  const camp = await makeCampaign(store, admin); const p = newPostUrl();
  const id = await createSubmission({ influencerId: await makeCreator(store), campaignId: camp, storeId: store, postUrl: p.url });
  assert.equal((await sub(id)).status, 'NOT_LIVE');
  assert.equal((await campaign(camp)).reserved_paise, 0);
});
test('Post published before the campaign started is rejected', async () => {
  const camp = await makeCampaign(store, admin);
  const old = { ...live(25000, 900, 100), publishedAt: new Date('2020-01-01') };
  const s = await submit(await makeCreator(store), camp, old);
  assert.equal((await sub(s.id)).status, 'REJECTED');
});
test('Gate outcomes: low engagement rejected; suspected bots restricted with money frozen', async () => {
  const camp = await makeCampaign(store, admin);
  const lowEng = await submit(await makeCreator(store), camp, live(100000, 500, 10));
  await makeDue(lowEng.id);
  assert.equal(await finalizeSubmission(lowEng.id), 'REJECTED');
  const bots = await submit(await makeCreator(store), camp, { ...live(100000, 2000, 100), metrics: { views: 100000, likes: 2000, comments: 100, followers: 500 } });
  await makeDue(bots.id);
  assert.equal(await finalizeSubmission(bots.id), 'RESTRICTED');
  assert.equal(await q1(`SELECT id FROM earnings WHERE submission_id=$1`, [bots.id]), undefined);
});
test('API outage: a failed check neither punishes nor pays', async () => {
  const camp = await makeCampaign(store, admin);
  const s = await submit(await makeCreator(store), camp);
  await reviewContent(s.id, adm(), 'APPROVED'); await makeDue(s.id);
  posts.set(s.key, { outcome: 'API_ERROR', detail: 'down' });
  assert.equal(await finalizeSubmission(s.id), 'API_ERROR');
  assert.equal((await sub(s.id)).status, 'MEASURING');
});
test('Waits for content review, then pays once approved', async () => {
  const camp = await makeCampaign(store, admin);
  const s = await submit(await makeCreator(store), camp);
  await makeDue(s.id);
  assert.equal(await finalizeSubmission(s.id), 'WAITING_CONTENT_REVIEW');
  await reviewContent(s.id, adm(), 'APPROVED');
  assert.equal((await sub(s.id)).status, 'APPROVED');
});
test('Happy path: post to payment with correct money and reports', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await approved(creator, camp);
  // 25,000 views: (1000 + 400) x 1.5 = Rs 2,100; below TDS threshold
  const e = await q1(`SELECT * FROM earnings WHERE submission_id=$1`, [s.id]);
  assert.equal(e.gross_paise, 210000);
  assert.equal((await campaign(camp)).reserved_paise, 210000); // budget shrinks to the actual amount
  const { batchId, items } = await generateBatch(admin);
  assert.equal(items, 1);
  await assert.rejects(releaseBatch(batchId!, admin), /approved batch/);
  await approveBatch(batchId!, admin2);
  const r = await releaseBatch(batchId!, admin);
  assert.equal(r.ready, 1);
  const { lines } = await bankPaymentLines(batchId!, admin2);
  assert.equal(lines.length, 1); assert.equal(lines[0]!.rupees, 2100); assert.equal(lines[0]!.accountNumber, '123456789012345678'); assert.equal(lines[0]!.ifsc, 'HDFC0001234');
  const item = await q1(`SELECT id FROM payment_batch_items WHERE batch_id=$1`, [batchId]);
  assert.equal((await sub(s.id)).status, 'IN_BATCH'); // not paid until the bank has paid
  await recordBankPaid(item.id, 'UTR123456', admin2);
  assert.equal((await sub(s.id)).status, 'PAID');
  assert.match(await batchCsv(batchId!), /2100\.00,0\.00,0\.00,2100\.00,PAID,UTR123456/);
  await assert.rejects(recordBankPaid(item.id, 'UTR999999', admin2), /ready to pay/); // cannot pay twice
  await assert.rejects(releaseBatch(batchId!, admin), /approved batch/);
  assert.equal((await bankPaymentLines(batchId!, admin2)).lines.length, 0);
});
test('TDS through a real batch: threshold crossing across payments', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  await pool.query(`INSERT INTO custom_rate_cards (influencer_id,base_pay_paise,bonus_per_10k_paise,max_view_bonus_paise,reason) VALUES ($1,2000000,0,0,'test')`, [creator]);
  const totals: number[] = [];
  for (let i = 0; i < 2; i++) { // Rs 20,000 x 1.5 = Rs 30,000 each
    await approved(creator, camp);
    const { batchId } = await generateBatch(admin);
    await approveBatch(batchId!, admin2); await releaseBatch(batchId!, admin);
    await recordBankPaid((await q1(`SELECT id FROM payment_batch_items WHERE batch_id=$1`, [batchId])).id, `UTR00000${i}`, admin2);
    totals.push((await q1(`SELECT tds_paise FROM payment_batch_items WHERE batch_id=$1`, [batchId])).tds_paise);
  }
  // First Rs 30,000 under threshold; second brings the year to Rs 60,000, so TDS = Rs 6,000
  assert.deepEqual(totals, [0, 600000]);
});
test('Zero pay: post deleted before payment means no money, voided tax, budget returned', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await approved(creator, camp);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin2);
  posts.delete(s.key);
  const r = await releaseBatch(batchId!, admin);
  assert.equal(r.voided, 1); assert.equal((await bankPaymentLines(batchId!, admin2)).lines.length, 0);
  assert.equal((await sub(s.id)).status, 'NOT_LIVE');
  assert.equal((await q1(`SELECT status FROM earnings WHERE submission_id=$1`, [s.id])).status, 'VOID');
  assert.equal((await q1(`SELECT is_void FROM tds_ledger WHERE influencer_id=$1`, [creator])).is_void, true);
  assert.equal((await campaign(camp)).reserved_paise, 0);
});
test('Zero pay: check unavailable at payout time holds money for the next sheet', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await approved(creator, camp);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin2);
  posts.set(s.key, { outcome: 'API_ERROR', detail: 'Meta down' });
  assert.equal((await releaseBatch(batchId!, admin)).requeued, 1);
  assert.equal((await bankPaymentLines(batchId!, admin2)).lines.length, 0);
  assert.equal((await q1(`SELECT status FROM earnings WHERE submission_id=$1`, [s.id])).status, 'PAYABLE');
  await clearQueue();
});
test('Database refuses payment with no recent live check, even if the app has a bug', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await approved(creator, camp);
  const { batchId } = await generateBatch(admin);
  await pool.query(`UPDATE social_link_verifications SET checked_at=now()-interval '3 days' WHERE submission_id=$1`, [s.id]);
  await assert.rejects(pool.query(`UPDATE payment_batch_items SET status='PROCESSING' WHERE batch_id=$1`, [batchId]), /zero-pay rule/);
});
test('Database refuses to exceed budget and refuses audit edits', async () => {
  const camp = await makeCampaign(store, admin, { budget: 100 });
  await assert.rejects(pool.query(`UPDATE campaigns SET reserved_paise=101 WHERE id=$1`, [camp]), /never_over_budget/);
  await assert.rejects(pool.query(`UPDATE audit_logs SET reason='x'`), /append-only/);
  await assert.rejects(pool.query(`DELETE FROM audit_logs`), /append-only/);
});
test('Override: an admin can clear a live post; nobody can pay a deleted one; stores cannot override', async () => {
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const low = await submit(creator, camp, live(100000, 500, 10));
  await makeDue(low.id); await finalizeSubmission(low.id);
  await assert.rejects(overrideSubmission(mgr(), low.id, 'Store trying'), /Only an admin/);
  const t = await raiseDispute(creator, { submissionId: low.id, subject: 'Glitch', description: 'Numbers look wrong to me' });
  await resolveDispute(adm(), t, { uphold: true, forceApprove: true, note: 'Checked insights screenshot' });
  assert.equal((await sub(low.id)).status, 'APPROVED');
  const gone = await submit(creator, camp); posts.delete(gone.key);
  await checkSubmission(gone.id, 'SCHEDULED');
  const t2 = await raiseDispute(creator, { submissionId: gone.id, subject: 'Pay me', description: 'I deleted it but please pay' });
  await assert.rejects(resolveDispute(adm(), t2, { uphold: true, forceApprove: true, note: 'Trying it' }), /cannot be paid/);
  await pool.query(`UPDATE earnings SET status='VOID' WHERE submission_id=$1`, [low.id]);
});
test('Override: unverifiable post needs an admin to enter the views', async () => {
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const p = newPostUrl(); posts.set(p.key, { outcome: 'API_ERROR', detail: 'down' });
  const id = await createSubmission({ influencerId: creator, campaignId: camp, storeId: store, postUrl: p.url });
  await assert.rejects(overrideSubmission(adm(), id, 'Checked by hand'), /views/);
  await overrideSubmission(adm(), id, 'Checked by hand', 30000);
  assert.equal((await sub(id)).live_check_waived, true);
  await pool.query(`UPDATE earnings SET status='VOID' WHERE submission_id=$1`, [id]);
});
test('Store login: only store visits; posts, creators, disputes and money are refused', async () => {
  const app = buildApp();
  const tok = jwt.sign({ id: manager, role: 'STORE_MANAGER', storeId: store }, process.env.JWT_SECRET!);
  const h = { authorization: `Bearer ${tok}` };
  await request(app).get('/manager/visits').set(h).expect(200);
  for (const p of ['/manager/submissions', '/manager/disputes', '/manager/roster', '/manager/campaigns', '/manager/demo-units', `/manager/stores/${store}/nearby-creators`]) {
    await request(app).get(p).set(h).expect(404);
  }
  await request(app).get('/admin/submissions').set(h).expect(403);
  await request(app).post('/manager/influencers/00000000-0000-0000-0000-000000000000/vet').set(h).send({}).expect(404);
  await assert.rejects(reviewContent('00000000-0000-0000-0000-000000000000', mgr(), 'APPROVED'), /Submission not found|Only an admin/);
});
test('Blacklist and post approval work for the second admin', async () => {
  const app = buildApp();
  const tok = jwt.sign({ id: admin2, role: 'ADMIN', storeId: null }, process.env.JWT_SECRET!);
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await submit(creator, camp);
  await request(app).post(`/admin/submissions/${s.id}/content-review`).set('authorization', `Bearer ${tok}`).send({ decision: 'APPROVED' }).expect(200);
  assert.equal((await sub(s.id)).content_review, 'APPROVED');
  await request(app).post(`/admin/influencers/${creator}/blacklist`).set('authorization', `Bearer ${tok}`).send({ blacklisted: true, reason: 'Fake followers' }).expect(200);
  await assert.rejects(submit(creator, camp), /cannot take part/);
});
async function paySheet(creator: string, camp: string) {
  await approved(creator, camp);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin2); await releaseBatch(batchId!, admin);
  const item = await q1(`SELECT * FROM payment_batch_items WHERE batch_id=$1`, [batchId]);
  await recordBankPaid(item.id, `UTR${Date.now()}`, admin);
  return item;
}
const bigRate = (c: string, base: number) => pool.query(`INSERT INTO custom_rate_cards (influencer_id,base_pay_paise,bonus_per_10k_paise,max_view_bonus_paise,reason) VALUES ($1,$2,0,0,'test')`, [c, base]);
test('TDS 194J: nothing to Rs 50,000, then 10% on the year; invalid PAN means 20%; no ITR rule exists', async () => {
  await clearQueue();
  const camp = await makeCampaign(store, admin);
  const c1 = await makeCreator(store); await bigRate(c1, 3000000); // Rs 45,000 per post after multiplier
  assert.equal((await paySheet(c1, camp)).tds_paise, 0);
  assert.equal((await paySheet(c1, camp)).tds_paise, 900000); // Rs 90,000 x 10%
  const c2 = await makeCreator(store); await bigRate(c2, 4000000); // Rs 60,000
  await pool.query(`UPDATE tax_records SET pan_status='INOPERATIVE' WHERE influencer_id=$1`, [c2]);
  const item = await paySheet(c2, camp);
  assert.equal(item.tds_paise, 1200000); // 20%
  assert.equal(item.net_paise, 4800000);
});
test('TDS 194C: 1% over Rs 30,000 single or Rs 1 lakh yearly; 2% for firms; thresholds run per section', async () => {
  await clearQueue();
  const camp = await makeCampaign(store, admin);
  const small = await makeCreator(store); await bigRate(small, 1000000); // Rs 15,000
  await pool.query(`UPDATE influencer_profiles SET engagement_type='CONTRACT_INDIVIDUAL' WHERE user_id=$1`, [small]);
  assert.equal((await paySheet(small, camp)).tds_paise, 0);
  const large = await makeCreator(store); await bigRate(large, 4000000); // Rs 60,000: over single limit
  await pool.query(`UPDATE influencer_profiles SET engagement_type='CONTRACT_INDIVIDUAL' WHERE user_id=$1`, [large]);
  assert.equal((await paySheet(large, camp)).tds_paise, 60000); // 1% of this payment
  assert.equal((await paySheet(large, camp)).tds_paise, 120000 - 60000); // Rs 1.2 lakh year: 1% of all, less paid
  const firm = await makeCreator(store); await bigRate(firm, 4000000);
  await pool.query(`UPDATE influencer_profiles SET engagement_type='CONTRACT_OTHER' WHERE user_id=$1`, [firm]);
  assert.equal((await paySheet(firm, camp)).tds_paise, 120000); // 2%
});
test('Salaried: kept out of the sheet, because payroll handles section 192', async () => {
  await clearQueue();
  const camp = await makeCampaign(store, admin); const c = await makeCreator(store);
  await pool.query(`UPDATE influencer_profiles SET engagement_type='SALARIED' WHERE user_id=$1`, [c]);
  await approved(c, camp);
  const r = await generateBatch(admin);
  assert.equal(r.batchId, null); assert.match(r.held[0]!.reason, /payroll/);
  await clearQueue();
});
test('TDS 194R: 10% once yearly benefits pass Rs 20,000; taken from pay, restored if voided, carried forward', async () => {
  await clearQueue();
  const app = buildApp();
  const tok = jwt.sign({ id: admin, role: 'ADMIN', storeId: null }, process.env.JWT_SECRET!);
  const h = { authorization: `Bearer ${tok}` };
  const camp = await makeCampaign(store, admin); const c = await makeCreator(store);
  const today = new Date().toISOString().slice(0, 10);
  const give = (v: number, recoverFromPayout = true) => request(app).post('/admin/benefits').set(h).send({ influencerId: c, description: 'Gift', valuePaise: v, givenOn: today, recoverFromPayout }).expect(201);
  assert.equal((await give(1500000)).body.tds_paise, 0); // Rs 15,000: under
  assert.equal((await give(1000000)).body.tds_paise, 250000); // Rs 25,000 total x 10%
  const s = await approved(c, camp, live(62000, 2100, 180)); // earns Rs 3,300
  const { batchId } = await generateBatch(admin);
  const item = await q1(`SELECT * FROM payment_batch_items WHERE batch_id=$1`, [batchId]);
  assert.equal(item.benefit_tds_paise, 250000); assert.equal(item.net_paise, 330000 - 250000);
  await approveBatch(batchId!, admin2);
  posts.delete(s.key); await pool.query(`UPDATE submissions SET live_check_waived=FALSE WHERE id=$1`, [s.id]);
  await releaseBatch(batchId!, admin);
  assert.equal((await q1(`SELECT SUM(recovered_paise)::bigint r FROM benefit_records WHERE influencer_id=$1`, [c])).r, 0); // restored
  const report = await request(app).get('/admin/tax-report.csv').set(h).expect(200);
  assert.match(report.text, /194R,10\.00,Yes,10000\.00,2500\.00/);
  await clearQueue();
});
test('Admin creates campaigns with empty and populated posting specifications', async () => {
  const app = buildApp();
  const authorization = `Bearer ${jwt.sign({ id: admin, role: 'ADMIN', storeId: null }, process.env.JWT_SECRET!)}`;
  const common = { title: 'Campaign test', brief: 'A campaign description', categoryId: await categoryId(), storeIds: [store],
    startsAt: '2030-01-01T00:00:00.000Z', expiresAt: '2030-02-01T00:00:00.000Z', budgetPaise: 250000, submissionQuota: 1 };
  for (const specs of [{}, { postingHashtags: ['#Lotus'], postingMentions: ['@lotus'] }]) {
    const result = await request(app).post('/admin/campaigns').set('authorization', authorization).send({ ...common, ...specs }).expect(201);
    const saved = await q1(`SELECT posting_hashtags, posting_mentions FROM campaigns WHERE id=$1`, [result.body.id]);
    assert.deepEqual(saved.posting_hashtags, specs.postingHashtags ?? []);
    assert.deepEqual(saved.posting_mentions, specs.postingMentions ?? []);
  }
});
test('Posting specs: admin sets them, creator sees them, a post missing a tag is held', async () => {
  const app = buildApp();
  const h = { authorization: `Bearer ${jwt.sign({ id: admin, role: 'ADMIN', storeId: null }, process.env.JWT_SECRET!)}` };
  const camp = await makeCampaign(store, admin); const c = await makeCreator(store);
  await request(app).put(`/admin/campaigns/${camp}/posting`).set(h).send({ postingHashtags: ['bad tag'] }).expect(400);
  await request(app).put(`/admin/campaigns/${camp}/posting`).set(h).send({ postingHashtags: ['#LotusDiwali'], postingMentions: ['@lotuselectronics'], postingGuidelines: 'Say the store name' }).expect(200);
  const ch = { authorization: `Bearer ${jwt.sign({ id: c, role: 'INFLUENCER', storeId: null, tv: 0 }, process.env.JWT_SECRET!)}` };
  const seen = (await request(app).get('/influencer/campaigns').set(ch).expect(200)).body.find((x: any) => x.id === camp);
  assert.deepEqual(seen.posting_hashtags, ['#LotusDiwali']); assert.equal(seen.posting_guidelines, 'Say the store name');
  const missing = await submit(c, camp, live(25000, 900, 100, 'Deal #ad @lotuselectronics'));
  await reviewContent(missing.id, adm(), 'APPROVED'); await makeDue(missing.id);
  assert.equal(await finalizeSubmission(missing.id), 'RESTRICTED');
  assert.match((await sub(missing.id)).status_reason, /#LotusDiwali/);
  const good = await submit(c, camp, live(25000, 900, 100, 'Deal #ad #LotusDiwali @lotuselectronics'));
  await reviewContent(good.id, adm(), 'APPROVED'); await makeDue(good.id);
  assert.equal(await finalizeSubmission(good.id), 'APPROVED');
  await pool.query(`UPDATE earnings SET status='VOID' WHERE submission_id=$1`, [good.id]);
});
test('Collab: Instagram posts need the invite tick; approved posts reach the sharing list once', async () => {
  const app = buildApp();
  const tok = (id: string, role: string) => ({ authorization: `Bearer ${jwt.sign({ id, role, storeId: role === 'STORE_MANAGER' ? store : null, tv: 0 }, process.env.JWT_SECRET!)}` });
  const camp = await makeCampaign(store, admin); const c = await makeCreator(store);
  await request(app).put(`/admin/campaigns/${camp}/posting`).set(tok(admin, 'ADMIN')).send({ collabAccount: 'lotus' }).expect(400);
  await request(app).put(`/admin/campaigns/${camp}/posting`).set(tok(admin, 'ADMIN')).send({ collabAccount: '@lotuselectronics' }).expect(200);
  const p = newPostUrl(); posts.set(p.key, live(25000, 900, 100));
  await assert.rejects(createSubmission({ influencerId: c, campaignId: camp, storeId: store, postUrl: p.url }), /Invite @lotuselectronics/);
  const id = await createSubmission({ influencerId: c, campaignId: camp, storeId: store, postUrl: p.url, collabConfirmed: true });
  assert.equal((await sub(id)).collab_confirmed, true);
  const list = async () => (await request(app).get('/admin/sharing').set(tok(admin, 'ADMIN')).expect(200)).body.filter((r: any) => r.id === id);
  assert.equal((await list()).length, 0, 'not shown before content review');
  await reviewContent(id, adm(), 'APPROVED');
  assert.equal((await list())[0].collab_account, '@lotuselectronics');
  await request(app).get('/admin/sharing').set(tok(manager, 'STORE_MANAGER')).expect(403);
  await request(app).post(`/admin/sharing/${id}`).set(tok(admin, 'ADMIN')).send({ done: true }).expect(200);
  await request(app).post(`/admin/sharing/${id}`).set(tok(admin, 'ADMIN')).send({ done: true }).expect(409);
  assert.ok((await list())[0].shared_at);
});
test('One paid entry per campaign: a second post is refused, a failed one frees a retry, the database holds the line', async () => {
  const camp = await makeCampaign(store, admin); const c = await makeCreator(store);
  const post = () => { const p = newPostUrl(); posts.set(p.key, live(25000, 900, 100)); return p.url; };
  const first = await createSubmission({ influencerId: c, campaignId: camp, storeId: store, postUrl: post() });
  await assert.rejects(createSubmission({ influencerId: c, campaignId: camp, storeId: store, postUrl: post() }), /paid once per campaign/);
  // Twenty tries at the same moment still give no second entry.
  const rush = await Promise.allSettled(Array.from({ length: 20 }, () => createSubmission({ influencerId: c, campaignId: camp, storeId: store, postUrl: post() })));
  assert.equal(rush.filter((r) => r.status === 'fulfilled').length, 0);
  // Even a bug that skips the app check is stopped by the database.
  const raw = (status: string) => pool.query(
    `INSERT INTO submissions (campaign_id, store_id, influencer_id, platform, post_url, platform_post_key, reserved_paise, rate_snapshot, measure_due_at, status)
     VALUES ($1,$2,$3,'YOUTUBE','https://youtu.be/x',$4,0,'{}',now(),$5)`, [camp, store, c, `RAW${Math.random()}`, status]);
  await assert.rejects(raw('MEASURING'), /ONE_ENTRY_PER_CAMPAIGN/);
  await raw('REJECTED'); // a finished, unpaid row is allowed
  // Once the first post ends with no pay, the creator may try again, and only that one can earn.
  await pool.query(`UPDATE submissions SET status='NOT_LIVE' WHERE id=$1`, [first]);
  const second = await createSubmission({ influencerId: c, campaignId: camp, storeId: store, postUrl: post() });
  // Reviving the old post now would make two entries, so the database refuses it.
  await assert.rejects(pool.query(`UPDATE submissions SET status='MEASURING' WHERE id=$1`, [first]), /ONE_ENTRY_PER_CAMPAIGN/);
  await reviewContent(second, adm(), 'APPROVED'); await makeDue(second);
  assert.equal(await finalizeSubmission(second), 'APPROVED');
  // And a second earning for the same creator and campaign is refused at the money itself.
  await pool.query(`ALTER TABLE submissions DISABLE TRIGGER submissions_one_entry`);
  try {
    await pool.query(`UPDATE submissions SET status='APPROVED' WHERE id=$1`, [first]);
    await assert.rejects(pool.query(
      `INSERT INTO earnings (submission_id, influencer_id, views_at_final, base_pay_paise, view_bonus_paise, multiplier_bps, gross_paise, payout_due_date)
       VALUES ($1,$2,1,1,0,10000,1,CURRENT_DATE)`, [first, c]), /ONE_PAYMENT_PER_CAMPAIGN/);
  } finally {
    await pool.query(`UPDATE submissions SET status='NOT_LIVE' WHERE id=$1`, [first]);
    await pool.query(`ALTER TABLE submissions ENABLE TRIGGER submissions_one_entry`);
  }
  // A different campaign is fine.
  await createSubmission({ influencerId: c, campaignId: await makeCampaign(store, admin), storeId: store, postUrl: post() });
  await pool.query(`UPDATE earnings SET status='VOID' WHERE submission_id=$1`, [second]);
});
test('Creator page shows the campaign is already entered; one bank account cannot serve two creators', async () => {
  const app = buildApp();
  const tok = (id: string) => ({ authorization: `Bearer ${jwt.sign({ id, role: 'INFLUENCER', storeId: null, tv: 0 }, process.env.JWT_SECRET!)}` });
  const camp = await makeCampaign(store, admin); const a = await makeCreator(store); const b = await makeCreator(store);
  await submit(a, camp);
  const seen = (await request(app).get('/influencer/campaigns').set(tok(a)).expect(200)).body.find((x: any) => x.id === camp);
  assert.ok(seen.my_entry);
  assert.equal((await request(app).get('/influencer/campaigns').set(tok(b)).expect(200)).body.find((x: any) => x.id === camp).my_entry, null);
  for (const u of [a, b]) await pool.query(`UPDATE users SET password_hash=$2 WHERE id=$1`, [u, await bcrypt.hash('Pw-123456789', 4)]);
  const bank = { currentPassword: 'Pw-123456789', accountHolder: 'Same Person', accountNumber: '001234567890', ifsc: 'HDFC0001234' };
  await request(app).put('/influencer/payout-account').set(tok(a)).send(bank).expect(200);
  const r = await request(app).put('/influencer/payout-account').set(tok(b)).send({ ...bank, accountNumber: '1234567890' }).expect(409);
  assert.match(r.body.error, /already used by another creator/);
  await request(app).put('/influencer/payout-account').set(tok(a)).send(bank).expect(200); // saving your own again is fine
});
test('Pay and targets per campaign: level pay used as written, edits apply to new posts only, ended campaigns locked', async () => {
  const app = buildApp();
  const h = { authorization: `Bearer ${jwt.sign({ id: admin, role: 'ADMIN', storeId: null }, process.env.JWT_SECRET!)}` };
  const camp = await makeCampaign(store, admin); const early = await makeCreator(store); const late = await makeCreator(store); const deal = await makeCreator(store);
  const nano = (await q1(`SELECT id FROM tiers WHERE name='Nano'`)).id;
  // Before: standard Nano rate x TVs multiplier is used.
  const before = await submit(early, camp, live(30000, 1200, 100));
  assert.equal((await sub(before.id)).rate_snapshot.multiplierBps, 15000);
  await request(app).put(`/admin/campaigns/${camp}/terms`).set(h).send({ minViews: 40000, minEngagementBps: 20, measurementDays: 7, tierRates: [] }).expect(400); // 0.2% too low
  await request(app).put(`/admin/campaigns/${camp}/terms`).set(h).send({ minViews: 40000, minEngagementBps: 250, measurementDays: 5,
    tierRates: [{ tierId: nano, basePayPaise: 250000, bonusPer10kPaise: 10000, maxViewBonusPaise: 50000 }] }).expect(200);
  const k = (await request(app).get('/admin/campaigns').set(h).expect(200)).body.find((x: any) => x.id === camp);
  assert.equal(k.min_views, 40000); assert.equal(k.tier_rates[0].base_pay_paise, 250000);
  // The creator sees their pay for this campaign: Rs 2,500 + Rs 100 per 10k, up to Rs 3,000, no multiplier.
  const ch = { authorization: `Bearer ${jwt.sign({ id: late, role: 'INFLUENCER', storeId: null, tv: 0 }, process.env.JWT_SECRET!)}` };
  const mine = (await request(app).get('/influencer/campaigns').set(ch).expect(200)).body.find((x: any) => x.id === camp).my_pay;
  assert.deepEqual([mine.basePayPaise, mine.multiplierBps, mine.maxPaise], [250000, 10000, 300000]);
  const calc = (await request(app).post('/influencer/calculator').set(ch).send({ categoryId: k.category_id, views: 30000, campaignId: camp }).expect(200)).body;
  assert.equal(calc.grossPaise, 280000);
  // New post uses the new pay and targets; the earlier post keeps its own.
  const after = await submit(late, camp, live(30000, 1200, 100));
  for (const s of [before, after]) { await reviewContent(s.id, adm(), 'APPROVED'); await makeDue(s.id); }
  assert.equal(await finalizeSubmission(before.id), 'APPROVED', 'old targets: 500 views is enough');
  assert.equal(await finalizeSubmission(after.id), 'REJECTED', 'new targets: 30,000 views is under 40,000');
  // A personal deal still beats the campaign rate.
  await pool.query(`INSERT INTO custom_rate_cards (influencer_id, base_pay_paise, bonus_per_10k_paise, max_view_bonus_paise, reason, created_by) VALUES ($1,777700,0,0,'deal',$2)`, [deal, admin]);
  const d = await submit(deal, camp);
  assert.equal((await sub(d.id)).rate_snapshot.basePayPaise, 777700);
  await pool.query(`UPDATE earnings SET status='VOID' WHERE submission_id=$1`, [before.id]);
  // Clearing the campaign rates goes back to standard pay.
  await request(app).put(`/admin/campaigns/${camp}/terms`).set(h).send({ minViews: 500, minEngagementBps: 150, measurementDays: 7, tierRates: [] }).expect(200);
  assert.equal((await q1(`SELECT count(*)::int n FROM campaign_rate_cards WHERE campaign_id=$1`, [camp])).n, 0);
  await pool.query(`UPDATE campaigns SET status='CLOSED' WHERE id=$1`, [camp]);
  await request(app).put(`/admin/campaigns/${camp}/terms`).set(h).send({ minViews: 1, minEngagementBps: 150, measurementDays: 7 }).expect(409);
});
test('Bank failure: tax is undone and the payment joins the next sheet', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await approved(creator, camp);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin2); await releaseBatch(batchId!, admin);
  const item = await q1(`SELECT * FROM payment_batch_items WHERE batch_id=$1`, [batchId]);
  await recordBankFailed(item.id, 'Account closed', admin2);
  assert.equal((await sub(s.id)).status, 'APPROVED');
  assert.equal((await q1(`SELECT is_void FROM tds_ledger WHERE batch_item_id=$1`, [item.id])).is_void, true);
  const next = await generateBatch(admin);
  assert.equal(next.items, 1);
  await clearQueue();
});
test('Bank return after payment: a paid line can be reversed and retried', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await approved(creator, camp);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin2); await releaseBatch(batchId!, admin);
  const item = await q1(`SELECT id FROM payment_batch_items WHERE batch_id=$1`, [batchId]);
  await recordBankPaid(item.id, 'UTR111111', admin2);
  await recordBankFailed(item.id, 'Returned by bank', admin2);
  assert.equal((await sub(s.id)).status, 'APPROVED');
  await pool.query(`UPDATE earnings SET status='VOID' WHERE submission_id=$1`, [s.id]);
});
test('Stale check: a post deleted after preparing drops out of the bank file', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await approved(creator, camp);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin2); await releaseBatch(batchId!, admin);
  await pool.query(`UPDATE submissions SET last_live_check_at=now()-interval '2 days' WHERE id=$1`, [s.id]);
  posts.delete(s.key);
  assert.equal((await bankPaymentLines(batchId!, admin2)).lines.length, 0);
  assert.equal((await sub(s.id)).status, 'NOT_LIVE');
  assert.equal((await q1(`SELECT status FROM payment_batch_items WHERE batch_id=$1`, [batchId])).status, 'VOID');
});
test('Stale check: if the post cannot be checked, it is left out and reported', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await approved(creator, camp);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin2); await releaseBatch(batchId!, admin);
  await pool.query(`UPDATE submissions SET last_live_check_at=now()-interval '2 days' WHERE id=$1`, [s.id]);
  posts.set(s.key, { outcome: 'API_ERROR', detail: 'down' });
  const r = await bankPaymentLines(batchId!, admin2);
  assert.equal(r.lines.length, 0); assert.equal(r.skipped, 1);
});
test('Tiers: strong results promote, weak results demote, pinned creators stay', async () => {
  const creator = await makeCreator(store); const pinned = await makeCreator(store); const camp = await makeCampaign(store, admin);
  await pool.query(`UPDATE influencer_profiles SET tier_locked=TRUE WHERE user_id=$1`, [pinned]);
  for (const c of [creator, pinned]) for (let i = 0; i < 3; i++) await approved(c, camp, live(60000, 2000, 200));
  await reviewTiers();
  assert.equal((await q1(`SELECT t.name FROM influencer_profiles p JOIN tiers t ON t.id=p.tier_id WHERE p.user_id=$1`, [creator])).name, 'Mid');
  assert.equal((await q1(`SELECT t.name FROM influencer_profiles p JOIN tiers t ON t.id=p.tier_id WHERE p.user_id=$1`, [pinned])).name, 'Nano');
  await clearQueue();
});
test('Interrupted preparation: finishes on resume', async () => {
  await clearQueue();
  const c1 = await makeCreator(store); const c2 = await makeCreator(store); const camp = await makeCampaign(store, admin);
  await approved(c1, camp); await approved(c2, camp);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin2);
  await pool.query(`UPDATE payment_batches SET status='RELEASING' WHERE id=$1`, [batchId]);
  await pool.query(`UPDATE payment_batch_items SET status='PROCESSING' WHERE id=(SELECT id FROM payment_batch_items WHERE batch_id=$1 LIMIT 1)`, [batchId]);
  const r = await releaseBatch(batchId!, null, true);
  assert.equal(r.ready, 1);
  assert.equal((await bankPaymentLines(batchId!, admin2)).lines.length, 2);
});
test('Nightly job: expires campaigns, finishes due posts, builds one sheet a day', async () => {
  await clearQueue();
  const camp = await makeCampaign(store, admin); const creator = await makeCreator(store);
  const s = await submit(creator, camp);
  await reviewContent(s.id, adm(), 'APPROVED'); await makeDue(s.id);
  const old = await makeCampaign(store, admin);
  await pool.query(`UPDATE campaigns SET starts_at=now()-interval '3 days', expires_at=now()-interval '1 day' WHERE id=$1`, [old]);
  await pool.query(`UPDATE payment_batches SET created_at=now()-interval '2 days'`);
  const r1 = await runJobs();
  assert.deepEqual(r1.errors, []);
  assert.equal((await campaign(old)).status, 'EXPIRED');
  assert.equal(r1.batch?.items, 1);
  assert.equal((await sub(s.id)).status, 'IN_BATCH');
  assert.equal((await runJobs()).batch, null);
  await pool.query(`UPDATE payment_batches SET status='CANCELLED' WHERE status='DRAFT'`);
});
test('HTTP: roles and store boundaries are enforced; PAN never comes back', async () => {
  const app = buildApp();
  const creator = await makeCreator(store);
  const tok = (id: string, role: string, storeId: string | null = null) => jwt.sign({ id, role, storeId }, process.env.JWT_SECRET!);
  await request(app).get('/admin/campaigns').expect(401);
  await request(app).get('/admin/campaigns').set('authorization', `Bearer ${tok(creator, 'INFLUENCER')}`).expect(403);
  await request(app).get('/admin/campaigns').set('authorization', `Bearer ${tok(manager, 'ADMIN')}`).expect(403); // a forged role in the token is ignored
  await request(app).get('/admin/campaigns').set('authorization', `Bearer ${tok(admin, 'ADMIN')}`).expect(200);
  await request(app).put('/influencer/tax').set('authorization', `Bearer ${tok(creator, 'INFLUENCER')}`).send({ pan: 'BADPAN', legalName: 'Test' }).expect(400);
  const saved = await request(app).put('/influencer/tax').set('authorization', `Bearer ${tok(creator, 'INFLUENCER')}`).send({ pan: 'pqrst6789k', legalName: 'Test Creator' }).expect(200);
  assert.deepEqual(saved.body, { panLast4: '789K' });
  const raw = await q1(`SELECT pan_encrypted FROM tax_records WHERE influencer_id=$1`, [creator]);
  assert.ok(!raw.pan_encrypted.includes('PQRST6789K'));
  const me = await request(app).get('/influencer/me').set('authorization', `Bearer ${tok(creator, 'INFLUENCER')}`).expect(200);
  assert.ok(!JSON.stringify(me.body).includes('PQRST'));
  assert.equal(me.body.pan_legal_name, 'Test Creator');
  const otherCreator = await makeCreator(store);
  const duplicate = await request(app).put('/influencer/tax').set('authorization', `Bearer ${tok(otherCreator, 'INFLUENCER')}`)
    .send({ pan: 'PQRST6789K', legalName: 'Other Creator' }).expect(409);
  assert.equal(duplicate.body.code, 'PAN_IN_USE');
  const unchanged = await q1(`SELECT legal_name, pan_last4 FROM tax_records WHERE influencer_id=$1`, [creator]);
  assert.equal(unchanged.legal_name, 'Test Creator');
  assert.equal(unchanged.pan_last4, '789K');
  assert.equal(me.body.payout_account_holder, 'Test');
  assert.equal(me.body.payout_ifsc, 'HDFC0001234');
  assert.ok(!JSON.stringify(me.body).includes('123456789012345678'));
  const nearby = await request(app).get(`/admin/stores/${store}/nearby-creators?km=5`).set('authorization', `Bearer ${tok(admin, 'ADMIN')}`).expect(200);
  assert.ok(nearby.body.some((x: any) => x.user_id === creator));
    await request(app).post('/internal/run-jobs').set('x-jobs-secret', 'wrong').expect(401);
});
test('Admin confirms only the PAN and bank details that were viewed', async () => {
  const app = buildApp();
  const creator = await makeCreator(store);
  const token = `Bearer ${jwt.sign({ id: admin, role: 'ADMIN', storeId: null }, process.env.JWT_SECRET!)}`;
  const pan = await request(app).get(`/admin/influencers/${creator}/pan`).set('authorization', token).expect(200);
  await request(app).post(`/admin/influencers/${creator}/pan/confirm`).set('authorization', token)
    .send({ viewedVersion: pan.body.version }).expect(200);
  assert.equal((await q1(`SELECT pan_status FROM tax_records WHERE influencer_id=$1`, [creator])).pan_status, 'VERIFIED');
  await pool.query(`UPDATE tax_records SET updated_at=DATE_ADD(updated_at, INTERVAL 1 SECOND) WHERE influencer_id=$1`, [creator]);
  await request(app).post(`/admin/influencers/${creator}/pan/invalid`).set('authorization', token)
    .send({ viewedVersion: pan.body.version }).expect(409);
  const bank = await request(app).get(`/admin/influencers/${creator}/bank`).set('authorization', token).expect(200);
  await request(app).post(`/admin/influencers/${creator}/bank/confirm`).set('authorization', token)
    .send({ viewedVersion: bank.body.version }).expect(200);
});
test('HTTP: register, then log in with the real password flow', async () => {
  const app = buildApp();
  const email = `new${Date.now()}@test.in`;
  const reg = await request(app).post('/auth/register').send({ fullName: 'New Creator', email, phone: '9' + String(Date.now()).slice(-9), password: 'long-enough-pass', homeStoreId: store, acceptPrivacy: true }).expect(201);
  assert.ok(reg.body.token);
  await request(app).post('/auth/login').send({ email, password: 'wrong-password' }).expect(401);
  await request(app).post('/auth/login').send({ email, password: 'long-enough-pass' }).expect(200);
});
test('Admin login: password alone is never enough, and two-step works end to end', async () => {
  const app = buildApp();
  const hash = await bcrypt.hash('admin-pass-12345', 4);
  const email = `boss${Date.now()}@test.in`;
  const { id } = await q1(`INSERT INTO users (role,full_name,email,password_hash) VALUES ('ADMIN','Boss',$1,$2) RETURNING id`, [email, hash]);
  const first = await request(app).post('/auth/login').send({ email, password: 'admin-pass-12345' }).expect(200);
  assert.equal(first.body.token, undefined); assert.equal(first.body.mfa, 'SETUP');
  await request(app).get('/admin/campaigns').set('authorization', `Bearer ${first.body.mfaToken}`).expect(401); // half-login opens nothing
  const setup = await request(app).post('/auth/mfa/setup').send({ mfaToken: first.body.mfaToken }).expect(200);
  const totp = new TOTP({ secret: Secret.fromBase32(setup.body.secret) });
  await request(app).post('/auth/mfa/enable').send({ mfaToken: first.body.mfaToken, code: '000000' }).expect(400);
  const on = await request(app).post('/auth/mfa/enable').send({ mfaToken: first.body.mfaToken, code: totp.generate() }).expect(200);
  assert.equal(on.body.recoveryCodes.length, 8);
  await request(app).get('/admin/campaigns').set('authorization', `Bearer ${on.body.token}`).expect(200);
  const again = await request(app).post('/auth/login').send({ email, password: 'admin-pass-12345' }).expect(200);
  assert.equal(again.body.mfa, 'VERIFY');
  await request(app).post('/auth/mfa/setup').send({ mfaToken: again.body.mfaToken }).expect(409); // cannot re-enrol to steal it
  const rec = await request(app).post('/auth/mfa/verify').send({ mfaToken: again.body.mfaToken, code: on.body.recoveryCodes[0] }).expect(200);
  await request(app).post('/auth/mfa/verify').send({ mfaToken: again.body.mfaToken, code: on.body.recoveryCodes[0] }).expect(400); // single use
  const live1 = totp.generate();
  await request(app).post('/auth/mfa/verify').send({ mfaToken: again.body.mfaToken, code: live1 }).expect(200);
  await request(app).post('/auth/mfa/verify').send({ mfaToken: again.body.mfaToken, code: live1 }).expect(400); // no replay
  // Changing the password ends the old session
  const ch = await request(app).post('/auth/change-password').set('authorization', `Bearer ${rec.body.token}`).send({ current: 'admin-pass-12345', next: 'admin-pass-67890' }).expect(200);
  await request(app).get('/admin/campaigns').set('authorization', `Bearer ${rec.body.token}`).expect(401);
  await request(app).get('/admin/campaigns').set('authorization', `Bearer ${ch.body.token}`).expect(200);
  await pool.query(`UPDATE users SET is_active=FALSE WHERE id=$1`, [id]);
});
test('Two-step switch: only the exact word off disables it', async () => {
  const app = buildApp();
  const email = `sw${Date.now()}@test.in`;
  await q1(`INSERT INTO users (role,full_name,email,password_hash) VALUES ('ADMIN','S',$1,$2) RETURNING id`, [email, await bcrypt.hash('switch-pass-12345', 4)]);
  const login = () => request(app).post('/auth/login').send({ email, password: 'switch-pass-12345' }).expect(200);
  process.env.ADMIN_TWO_STEP = 'OFF ';
  assert.equal((await login()).body.token, undefined);
  process.env.ADMIN_TWO_STEP = 'off';
  const r = await login();
  assert.ok(r.body.token); assert.equal(r.body.role, 'ADMIN');
  delete process.env.ADMIN_TWO_STEP;
  assert.equal((await login()).body.token, undefined);
});
test('Login lockout: repeated wrong passwords lock the account, even with the right one afterwards', async () => {
  const app = buildApp();
  const hash = await bcrypt.hash('right-password-1', 4);
  const email = `lock${Date.now()}@test.in`;
  await q1(`INSERT INTO users (role,full_name,email,password_hash) VALUES ('STORE_MANAGER','L',$1,$2,$3) RETURNING id`.replace("password_hash)", "password_hash,store_id)"), [email, hash, store]);
  for (let i = 0; i < 8; i++) await request(app).post('/auth/login').send({ email, password: 'wrong-password' }).expect(401);
  await request(app).post('/auth/login').send({ email, password: 'right-password-1' }).expect(429);
  await pool.query(`DELETE FROM auth_attempts`);
});
test('Bank file: a line goes on one file only; repeating needs a reason', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  await approved(creator, camp);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin2); await releaseBatch(batchId!, admin);
  assert.equal((await bankPaymentLines(batchId!, admin)).lines.length, 1);
  assert.equal((await bankPaymentLines(batchId!, admin)).lines.length, 0);
  assert.equal((await bankPaymentLines(batchId!, admin, 'Bank upload failed, nothing paid')).lines.length, 1);
  await clearQueue();
});
test('PAN change: payment waits for an admin, and past tax entries keep the old PAN', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  await approved(creator, camp);
  await pool.query(`UPDATE tax_records SET pan_status='UNVERIFIED' WHERE influencer_id=$1`, [creator]);
  const held = await generateBatch(admin);
  assert.equal(held.batchId, null); assert.match(held.held[0]!.reason, /PAN is waiting/);
  await clearQueue();
});
test('Rival claim: someone else submitting a post cannot block its real owner', async () => {
  const rival = await makeCreator(store); const owner = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const p = newPostUrl(); posts.set(p.key, { outcome: 'NOT_OWNER', detail: 'Not their account' });
  const bad = await createSubmission({ influencerId: rival, campaignId: camp, storeId: store, postUrl: p.url });
  assert.equal((await sub(bad)).status, 'NOT_LIVE');
  posts.set(p.key, live(25000, 900, 100));
  const good = await createSubmission({ influencerId: owner, campaignId: camp, storeId: store, postUrl: `https://www.instagram.com/p/${p.key}/?x=https://evil.example` });
  assert.equal((await sub(good)).status, 'MEASURING');
  assert.equal((await sub(good)).post_url, `https://www.instagram.com/p/${p.key}/`); // clean link stored
});
test('Single admin: one admin can create, approve and prepare a sheet alone', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  await approved(creator, camp);
  await pool.query(`UPDATE payout_accounts SET verified_by=$2 WHERE influencer_id=$1`, [creator, admin]);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin);
  assert.equal((await releaseBatch(batchId!, admin)).ready, 1);
  assert.equal((await bankPaymentLines(batchId!, admin)).lines.length, 1);
  await clearQueue();
});
test('Password reset: link works once; old sessions end; bank details need re-confirming', async () => {
  const app = buildApp();
  const creator = await makeCreator(store);
  const tok = jwt.sign({ id: creator, role: 'INFLUENCER', storeId: null, tv: 0 }, process.env.JWT_SECRET!);
  await request(app).get('/influencer/me').set('authorization', `Bearer ${tok}`).expect(200);
  await request(app).post('/auth/forgot-password').send({ email: 'nobody@nowhere.in' }).expect(200); // same answer for unknown emails
  const adminTok = jwt.sign({ id: admin, role: 'ADMIN', storeId: null }, process.env.JWT_SECRET!);
  const { body } = await request(app).post(`/admin/users/${creator}/reset-link`).set('authorization', `Bearer ${adminTok}`).expect(200);
  const token = new URL(body.link, 'https://x.in').searchParams.get('token')!;
  const stored = await q1(`SELECT token_hash FROM password_resets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [creator]);
  assert.notEqual(stored.token_hash, token); // only a hash is kept
  await request(app).post('/auth/reset-password').send({ token, password: 'short' }).expect(400);
  await request(app).post('/auth/reset-password').send({ token, password: 'a-brand-new-password' }).expect(200);
  await request(app).post('/auth/reset-password').send({ token, password: 'another-new-password' }).expect(400);
  await request(app).get('/influencer/me').set('authorization', `Bearer ${tok}`).expect(401);
  assert.equal((await q1(`SELECT verified_at FROM payout_accounts WHERE influencer_id=$1`, [creator])).verified_at, null);
});
test('New staff must choose their own password before doing anything', async () => {
  const app = buildApp();
  const adminTok = jwt.sign({ id: admin, role: 'ADMIN', storeId: null }, process.env.JWT_SECRET!);
  const email = `newmgr${Date.now()}@test.in`;
  await request(app).post('/admin/staff').set('authorization', `Bearer ${adminTok}`).send({ role: 'ADMIN', fullName: 'X', email, password: 'temporary-pass-1' }).expect(400); // own password required for a new admin
  await request(app).post('/admin/staff').set('authorization', `Bearer ${adminTok}`).send({ role: 'STORE_MANAGER', fullName: 'New', email, password: 'temporary-pass-1', storeId: store }).expect(201);
  const login = await request(app).post('/auth/login').send({ email, password: 'temporary-pass-1' }).expect(200);
  const denied = await request(app).get('/manager/visits').set('authorization', `Bearer ${login.body.token}`).expect(403);
  assert.equal(denied.body.code, 'PASSWORD_CHANGE_REQUIRED');
  const ch = await request(app).post('/auth/change-password').set('authorization', `Bearer ${login.body.token}`).send({ current: 'temporary-pass-1', next: 'my-own-password-1' }).expect(200);
  await request(app).get('/manager/visits').set('authorization', `Bearer ${ch.body.token}`).expect(200);
});
test('Erase: refuses with open items; removes personal data and keeps tax records', async () => {
  const app = buildApp();
  const adminTok = jwt.sign({ id: admin, role: 'ADMIN', storeId: null }, process.env.JWT_SECRET!);
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  const s = await submit(creator, camp);
  await request(app).post(`/admin/influencers/${creator}/erase`).set('authorization', `Bearer ${adminTok}`).send({ reason: 'Asked to delete' }).expect(409);
  await reviewContent(s.id, adm(), 'REJECTED', 'Wrong product');
  await request(app).post(`/admin/influencers/${creator}/erase`).set('authorization', `Bearer ${adminTok}`).send({ reason: 'Asked to delete' }).expect(200);
  const u = await q1(`SELECT full_name,email,phone,is_active FROM users WHERE id=$1`, [creator]);
  assert.equal(u.full_name, 'Deleted creator'); assert.equal(u.is_active, false); assert.equal(u.phone, null);
  assert.equal(await q1(`SELECT 1 x FROM payout_accounts WHERE influencer_id=$1`, [creator]), undefined);
  assert.ok(await q1(`SELECT 1 x FROM tax_records WHERE influencer_id=$1`, [creator]));
});
test('Calculator uses the same engine as real pay', async () => {
  const app = buildApp();
  const creator = await makeCreator(store);
  const tok = jwt.sign({ id: creator, role: 'INFLUENCER', storeId: null, tv: 0 }, process.env.JWT_SECRET!);
  const r = await request(app).post('/influencer/calculator').set('authorization', `Bearer ${tok}`).send({ categoryId: await categoryId(), views: 50000 }).expect(200);
  assert.equal(r.body.grossPaise, 300000);
});
test('Creator routes for visits exist through the web address', async () => {
  const app = buildApp(); const c = await makeCreator(store);
  const h = { authorization: `Bearer ${jwt.sign({ id: c, role: 'INFLUENCER', storeId: null, tv: 0 }, process.env.JWT_SECRET!)}` };
  await request(app).get('/influencer/visits').set(h).expect(200);
  await request(app).get(`/influencer/visits/slots?storeId=${store}`).set(h).expect(200);
});
test('Visits: only store windows bookable; capacity holds under a rush; store decides', async () => {
  const hub = await makeStore(); const boss = await makeUser('STORE_MANAGER', hub);
  const m = { id: boss, role: 'STORE_MANAGER', storeId: hub };
  await assert.rejects(saveWindows(mgr(), hub, []), /access/); // another store's manager is blocked
  const all = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_time: '11:00', end_time: '13:00', slot_minutes: 60, capacity: 2 }));
  await saveWindows(m, hub, all);
  await assert.rejects(saveWindows(m, hub, [{ weekday: 1, start_time: '11:00', end_time: '13:00', slot_minutes: 60, capacity: 1 }, { weekday: 1, start_time: '12:00', end_time: '14:00', slot_minutes: 60, capacity: 1 }]), /overlap/);
  const days = await availableSlots(hub);
  const slot = days[0]!.slots[0]!;
  assert.ok(new Date(slot.start).getTime() >= Date.now() + MIN_NOTICE_HOURS * 3600000);
  assert.ok(slot.start.endsWith(':30:00.000Z')); // 11:00 India = 05:30 UTC
  const creators = await Promise.all(Array.from({ length: 6 }, () => makeCreator(hub)));
  const results = await Promise.allSettled(creators.map((c) => requestVisit(c, { storeId: hub, slotStart: slot.start, purpose: 'Film TV walk-through' })));
  const won = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled');
  assert.equal(won.length, 2); // capacity is 2
  await assert.rejects(requestVisit(creators[0]!, { storeId: hub, slotStart: new Date(new Date(slot.start).getTime() + 1800000).toISOString(), purpose: 'Off-grid time' }), /does not take visits/);
  await assert.rejects(decideVisit(mgr(), won[0]!.value, { approve: true }), /another store/);
  await assert.rejects(decideVisit(m, won[0]!.value, { approve: false }), /why/);
  await decideVisit(m, won[0]!.value, { approve: true, note: 'See Ravi at the TV wall' });
  await assert.rejects(decideVisit(m, won[0]!.value, { approve: false, note: 'Changed mind' }), /already been answered/);
  assert.equal((await q1(`SELECT status FROM store_visits WHERE id=$1`, [won[0]!.value])).status, 'APPROVED');
  await decideVisit(m, won[1]!.value, { approve: false, note: 'Staff training that day' });
  const after = (await availableSlots(hub))[0]!.slots[0]!;
  assert.equal(after.left, 1); // a declined place opens up again
  await assert.rejects(recordOutcome(m, won[0]!.value, 'NO_SHOW'), /not started/);
});
test('Bank change: a new account blocks payment until an admin confirms it', async () => {
  await clearQueue();
  const creator = await makeCreator(store); const camp = await makeCampaign(store, admin);
  await approved(creator, camp);
  await pool.query(`UPDATE payout_accounts SET verified_at=NULL WHERE influencer_id=$1`, [creator]);
  const held = await generateBatch(admin);
  assert.equal(held.batchId, null); assert.match(held.held[0]!.reason, /admin to confirm/);
  await pool.query(`UPDATE payout_accounts SET verified_at=now() WHERE influencer_id=$1`, [creator]);
  const { batchId } = await generateBatch(admin);
  await approveBatch(batchId!, admin2); await releaseBatch(batchId!, admin);
  // Fraudster changes details after the sheet is prepared
  await pool.query(`UPDATE payout_accounts SET verified_at=NULL WHERE influencer_id=$1`, [creator]);
  const file = await bankPaymentLines(batchId!, admin2);
  assert.equal(file.lines.length, 0); assert.equal(file.skipped, 1);
  await clearQueue();
});
test('Vetting: one admin approves, and the PAN is confirmed', async () => {
  const app = buildApp();
  const reg = await request(app).post('/auth/register').send({ fullName: 'Vet Me', email: `vet${Date.now()}@test.in`, phone: '8' + String(Date.now()).slice(-9), password: 'long-enough-pass', homeStoreId: store, acceptPrivacy: true }).expect(201);
  const uid = (jwt.decode(reg.body.token) as any).id;
  const tok = (id: string, role: string, storeId: string | null = null) => jwt.sign({ id, role, storeId }, process.env.JWT_SECRET!);
  await request(app).put('/influencer/tax').set('authorization', `Bearer ${reg.body.token}`).send({ pan: 'LMNOP1234Q', legalName: 'Vet Me' }).expect(200);
  const a = `Bearer ${tok(admin, 'ADMIN')}`;
  await request(app).post(`/admin/influencers/${uid}/vet`).set('authorization', a).send({ approve: true, reason: 'PAN checked' }).expect(200);
  await request(app).post(`/admin/influencers/${uid}/vet`).set('authorization', a).send({ approve: true, reason: 'Again' }).expect(409);
  assert.equal((await q1(`SELECT pan_status FROM tax_records WHERE influencer_id=$1`, [uid])).pan_status, 'VERIFIED');
});
