import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encrypt, pool } from '../src/core.js';
import { flushOutbox } from '../src/engines/notifications.js';

test('Mailgun sends a branded reset to the account email without tracking', async () => {
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  let sentBody: URLSearchParams | undefined;
  let sentUrl = '';
  let markedSent = false;
  let template = 'password_reset';
  try {
    process.env.EMAIL_PROVIDER = 'mailgun';
    process.env.MAILGUN_API_KEY = 'test-key';
    process.env.MAILGUN_DOMAIN = 'mg.example.test';
    process.env.MAILGUN_REGION = 'us';
    process.env.MAILGUN_FROM = 'Lotus <noreply@example.test>';
    process.env.PUBLIC_URL = 'https://creator.example.test';
    const resetLink = 'https://creator.example.test/reset?token=test-token';
    pool.query = (async (sql: string) => {
      if (sql.includes('SELECT n.id')) return { rows: [{ id: 'one', template, payload: { linkEnc: encrypt(resetLink) }, created_at: new Date(), email: 'creator@example.test', full_name: '<Creator>', is_active: true }], rowCount: 1 };
      if (sql.includes("status='SENT'")) markedSent = true;
      return { rows: [], rowCount: 1 };
    }) as typeof pool.query;
    globalThis.fetch = (async (url, init) => { sentUrl = String(url); sentBody = init?.body as URLSearchParams; return new Response('{}', { status: 200 }); }) as typeof fetch;
    assert.equal(await flushOutbox(), 1);
    assert.equal(sentUrl, 'https://api.mailgun.net/v3/mg.example.test/messages');
    assert.equal(sentBody?.get('to'), 'creator@example.test');
    assert.equal(sentBody?.get('o:tracking'), 'no');
    assert.match(sentBody?.get('html') ?? '', /&#60;Creator&#62;/);
    assert.ok(sentBody?.get('html')?.includes(resetLink));
    assert.ok(markedSent);
    template = 'creator_registered';
    assert.equal(await flushOutbox(), 1);
    assert.match(sentBody?.get('text') ?? '', /under review/i);
    assert.ok(sentBody?.get('html')?.includes('https://creator.example.test/login'));
    template = 'creator_approved';
    assert.equal(await flushOutbox(), 1);
    assert.match(sentBody?.get('text') ?? '', /approved/i);
    markedSent = false;
    globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
    assert.equal(await flushOutbox(), 0);
    assert.equal(markedSent, false);
  } finally {
    pool.query = originalQuery;
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    await pool.end();
  }
});
