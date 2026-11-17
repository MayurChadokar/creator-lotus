// Test helpers: outside services are replaced by simulators so tests never touch real money or accounts.
import { randomUUID } from 'node:crypto';
import { encrypt, lookupHash, pool } from '../src/core.js';
import { setupDatabase } from '../src/dbSetup.js';
import { providers } from '../src/integrations/registry.js';
import type { PostCheck } from '../src/integrations/types.js';

export const posts = new Map<string, PostCheck>();
const social = { fetchPost: async (q: { key: string }) => posts.get(q.key) ?? { outcome: 'NOT_FOUND' as const, detail: 'Post missing' } };
providers.INSTAGRAM = social;
providers.YOUTUBE = social;

export const live = (views: number, likes: number | null, comments: number | null, caption = 'Great deal #ad'): PostCheck => ({
  outcome: 'LIVE', publishedAt: new Date(), caption, metrics: { views, likes, comments, followers: 20000, reach: views },
});

export async function resetDb() {
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()`);
  await pool.query('SET FOREIGN_KEY_CHECKS=0');
  for (const { table_name } of rows) await pool.query(`DROP TABLE IF EXISTS \`${table_name}\``);
  await pool.query('SET FOREIGN_KEY_CHECKS=1');
  await setupDatabase();
}
let seq = 0;
export const q1 = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0];

export async function makeStore() {
  seq++;
  return (await q1(`INSERT INTO stores (code,name,city,state,latitude,longitude) VALUES ($1,$2,'Indore','MP',22.7196,75.8577) RETURNING id`, [`S${seq}`, `Store ${seq}`])).id as string;
}
export async function makeUser(role: string, storeId: string | null = null) {
  seq++;
  return (await q1(`INSERT INTO users (role,full_name,email,password_hash,store_id) VALUES ($1,$2,$3,'x',$4) RETURNING id`, [role, `${role} ${seq}`, `u${seq}@test.in`, storeId])).id as string;
}
export const categoryId = async (name = 'TVs') => (await q1(`SELECT id FROM product_categories WHERE name=$1`, [name])).id as string;

/** A fully onboarded Nano creator (base Rs 1,000, Rs 200 per 10k views, bonus cap Rs 2,000). */
export async function makeCreator(storeId: string, lat = 22.72, lng = 75.86) {
  const id = await makeUser('INFLUENCER');
  const tier = (await q1(`SELECT id FROM tiers WHERE name='Nano'`)).id;
  await pool.query(`INSERT INTO influencer_profiles (user_id,tier_id,vetting_status,home_store_id,latitude,longitude) VALUES ($1,$2,'APPROVED',$3,$4,$5)`, [id, tier, storeId, lat, lng]);
  const pan = `ABCDE${String(1000 + (seq % 9000))}F`;
  await pool.query(`INSERT INTO tax_records (influencer_id,pan_encrypted,pan_lookup_hash,pan_last4,legal_name,pan_status) VALUES ($1,$2,$3,$4,'Test','VERIFIED')`, [id, encrypt(pan), lookupHash(pan + id), pan.slice(-4)]);
  await pool.query(`INSERT INTO payout_accounts (influencer_id,account_type,account_holder,account_number_enc,ifsc,masked_display,verified_at) VALUES ($1,'BANK','Test',$2,'HDFC0001234','A/c ending 6789',now())`, [id, encrypt('123456789012345678')]);
  await pool.query(`INSERT INTO social_accounts (influencer_id,platform,external_id,handle,access_token_enc) VALUES ($1,'INSTAGRAM',$2,'h',$3)`, [id, randomUUID(), encrypt('tok')]);
  const doc = await q1(`SELECT id,content_hash FROM legal_documents WHERE is_current`);
  await pool.query(`INSERT INTO legal_acceptance_logs (influencer_id,document_id,content_hash) VALUES ($1,$2,$3)`, [id, doc.id, doc.content_hash]);
  return id;
}
export async function makeCampaign(storeId: string, adminId: string, o: { budget?: number; quota?: number; minViews?: number } = {}) {
  const c = await q1(
    `INSERT INTO campaigns (title,brief,category_id,status,starts_at,expires_at,budget_paise,submission_quota,min_views,created_by)
     VALUES ('C','Brief text',$1,'OPEN',now()-interval '1 day',now()+interval '30 days',$2,$3,$4,$5) RETURNING id`,
    [await categoryId(), o.budget ?? 100000000, o.quota ?? 100, o.minViews ?? 500, adminId]);
  await pool.query(`INSERT INTO campaign_stores VALUES ($1,$2)`, [c.id, storeId]);
  return c.id as string;
}
let post = 0;
export const newPostUrl = () => { post++; const key = `Cpost${post}`; return { key, url: `https://www.instagram.com/reel/${key}/` }; };
export const campaign = (id: string) => q1(`SELECT * FROM campaigns WHERE id=$1`, [id]);
export const sub = (id: string) => q1(`SELECT * FROM submissions WHERE id=$1`, [id]);
export const makeDue = (id: string) => pool.query(`UPDATE submissions SET measure_due_at=now()-interval '1 minute' WHERE id=$1`, [id]);
