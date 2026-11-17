// Runs the real backend with only the outside services simulated, for browser testing.
// Never used in production. A video id starting with GONE counts as deleted.
import bcrypt from 'bcryptjs';
import { existsSync, readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { pool } from '../src/core.js';
import { setupDatabase } from '../src/dbSetup.js';

process.env.YOUTUBE_API_KEY = 'sim'; process.env.BREVO_API_KEY = 'sim'; process.env.MAIL_FROM = 'team@test.in'; process.env.PUBLIC_URL = 'http://localhost:3000';
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const channels = new Set<string>();
globalThis.fetch = (async (input: any, init?: any) => {
  const u = new URL(String(input));
  if (u.hostname === 'www.googleapis.com') {
    if (u.pathname.endsWith('/channels')) {
      const h = u.searchParams.get('forHandle');
      if (h) channels.add(`UC${h}`);
      return json({ items: [{ id: h ? `UC${h}` : u.searchParams.get('id'), snippet: { title: h ?? 'Channel', description: existsSync('/tmp/yt-desc') ? readFileSync('/tmp/yt-desc', 'utf8') : '' }, statistics: { subscriberCount: '24000' } }] });
    }
    const id = u.searchParams.get('id')!;
    if (id.startsWith('GONE')) return json({ items: [] });
    return json({ items: [{ snippet: { channelId: [...channels].at(-1), publishedAt: new Date().toISOString(), title: 'TV review #ad #LotusDiwali', description: '' }, status: { privacyStatus: 'public' }, statistics: { viewCount: '62000', likeCount: '2100', commentCount: '180' } }] });
  }
  if (u.hostname === 'api.brevo.com') return json({ messageId: 'sim' });
  throw new Error(`Unexpected outside call: ${u.hostname}`);
}) as typeof fetch;

await setupDatabase();
const hash = await bcrypt.hash('test-password-1', 10);
const { rows: [s] } = await pool.query(`INSERT INTO stores (code,name,city,state,latitude,longitude) VALUES ('IND1','Vijay Nagar Store','Indore','Madhya Pradesh',22.7533,75.8937),('BPL1','MP Nagar Store','Bhopal','Madhya Pradesh',23.2332,77.4345) RETURNING id`);
await pool.query(`INSERT INTO users (role,full_name,email,password_hash) VALUES ('ADMIN','Asha Admin','admin@test.in',$1),('ADMIN','Ravi Finance','finance@test.in',$1)`, [hash]);
await pool.query(`INSERT INTO users (role,full_name,email,password_hash,store_id) VALUES ('STORE_MANAGER','Manoj Manager','manager@test.in',$1,$2)`, [hash, s.id]);
buildApp().listen(4000, () => console.log('ready'));
