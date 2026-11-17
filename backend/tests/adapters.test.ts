// The Meta and YouTube connectors, against simulated replies shaped like the documented ones.
import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { encrypt, pool } from '../src/core.js';
import { instagram } from '../src/integrations/instagram.js';
import { youtube } from '../src/integrations/youtube.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
after(() => pool.end());
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const route = (fn: (u: string, init?: RequestInit) => Response) => { globalThis.fetch = (async (u: any, i: any) => fn(String(u), i)) as typeof fetch; };
process.env.YOUTUBE_API_KEY = 'k';
const yt = { key: 'dQw4w9WgXcQ', mediaId: null, accountExternalId: 'UC1', accessTokenEnc: null };

test('YouTube: live video; hidden likes stay unknown', async () => {
  route((u) => u.includes('/channels') ? json({ items: [{ statistics: { subscriberCount: '5000' } }] })
    : json({ items: [{ snippet: { channelId: 'UC1', publishedAt: '2026-11-01T00:00:00Z', title: 'Review #ad' }, status: { privacyStatus: 'public' }, statistics: { viewCount: '1000', commentCount: '5' } }] }));
  const r = await youtube.fetchPost(yt);
  assert.equal(r.outcome, 'LIVE'); assert.equal(r.metrics!.views, 1000); assert.equal(r.metrics!.likes, null); assert.equal(r.metrics!.followers, 5000);
});
test('YouTube: removed, private, someone else\'s channel, outage', async () => {
  route(() => json({ items: [] }));
  assert.equal((await youtube.fetchPost(yt)).outcome, 'NOT_FOUND');
  route(() => json({ items: [{ snippet: { channelId: 'UC1' }, status: { privacyStatus: 'private' }, statistics: {} }] }));
  assert.equal((await youtube.fetchPost(yt)).outcome, 'NOT_FOUND');
  route(() => json({ items: [{ snippet: { channelId: 'OTHER' }, status: { privacyStatus: 'public' }, statistics: { viewCount: '1' } }] }));
  assert.equal((await youtube.fetchPost(yt)).outcome, 'NOT_OWNER');
  route(() => json({}, 403));
  assert.equal((await youtube.fetchPost(yt)).outcome, 'API_ERROR');
});
const igq = () => ({ key: 'ABC', mediaId: null, accountExternalId: '1', accessTokenEnc: encrypt('tok') });
test('Instagram: finds the post on the creator\'s own account across pages, with views', async () => {
  route((u) => {
    if (u.includes('/insights')) return json({ data: [{ name: 'views', values: [{ value: 9000 }] }, { name: 'reach', values: [{ value: 7000 }] }] });
    if (u.includes('/me/media')) return u.includes('after=2')
      ? json({ data: [{ id: '55', permalink: 'https://www.instagram.com/reel/ABC/', timestamp: '2026-11-01T00:00:00+0000', like_count: 300, comments_count: 20, caption: '#ad' }] })
      : json({ data: [{ id: '44', permalink: 'https://www.instagram.com/p/ZZZ/' }], paging: { next: 'https://graph.instagram.com/v25.0/me/media?after=2' } });
    return json({ followers_count: 12000 });
  });
  const r = await instagram.fetchPost(igq());
  assert.equal(r.outcome, 'LIVE'); assert.equal(r.mediaId, '55'); assert.equal(r.metrics!.views, 9000); assert.equal(r.metrics!.reach, 7000); assert.equal(r.metrics!.followers, 12000);
});
test('Instagram: a post not on the account is NOT_FOUND', async () => {
  route(() => json({ data: [{ id: '44', permalink: 'https://www.instagram.com/p/ZZZ/' }] }));
  assert.equal((await instagram.fetchPost(igq())).outcome, 'NOT_FOUND');
});
test('Instagram: deleted post vs expired login are different outcomes', async () => {
  route(() => json({ error: { code: 100 } }, 400));
  assert.equal((await instagram.fetchPost({ ...igq(), mediaId: '55' })).outcome, 'NOT_FOUND');
  route(() => json({ error: { code: 190 } }, 400));
  const r = await instagram.fetchPost({ ...igq(), mediaId: '55' });
  assert.equal(r.outcome, 'API_ERROR'); assert.match(r.detail!, /reconnect/);
});
test('Email: sends through Brevo with no bank data, and a failure leaves it queued', async () => {
  const { flushOutbox } = await import('../src/engines/notifications.js');
  process.env.BREVO_API_KEY = 'k'; process.env.MAIL_FROM = 'team@test.in';
  const { resetDb, makeUser, q1 } = await import('./helpers.js');
  await resetDb();
  const u = await makeUser('ADMIN');
  await q1(`INSERT INTO notifications_outbox (user_id,template,payload) VALUES ($1,'admin_alert','{"what":"<b>Test</b>","by":"A"}') RETURNING id`, [u]);
  route(() => json({}, 500));
  assert.equal(await flushOutbox(), 0);
  assert.equal((await q1(`SELECT status FROM notifications_outbox`)).status, 'QUEUED');
  let sent: any; let url = '';
  route((x, i) => { url = x; sent = i; return json({ messageId: '1' }, 201); });
  assert.equal(await flushOutbox(), 1);
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(sent.headers['api-key'], 'k');
  const b = JSON.parse(sent.body);
  assert.match(b.htmlContent, /&#60;b&#62;Test/); // escaped
  assert.equal((await q1(`SELECT status FROM notifications_outbox`)).status, 'SENT');
  delete process.env.BREVO_API_KEY;
});
