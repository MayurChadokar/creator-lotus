import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/core.js';

test('duplicate bank account is rejected and the transaction rolls back', async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const oldSecret = process.env.JWT_SECRET;
  const oldKey = process.env.ENCRYPTION_KEY;
  const id = '11111111-1111-4111-8111-111111111111';
  const hash = await bcrypt.hash('old-password-123', 4);
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt';
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
  let rolledBack = false;
  let committed = false;
  try {
    pool.query = (async (sql: string) => {
      if (sql.startsWith('SELECT is_active, role')) return { rows: [{ is_active: 1, role: 'INFLUENCER', token_version: 0, must_change_password: false }], rowCount: 1 };
      if (sql.startsWith('SELECT password_hash')) return { rows: [{ password_hash: hash }], rowCount: 1 };
      throw new Error('Unexpected query');
    }) as typeof pool.query;
    pool.connect = (async () => ({
      beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => { rolledBack = true; }, release: () => {},
      query: async (sql: string) => {
        if (sql.startsWith('SELECT id FROM users')) return [[{ id }], []];
        if (sql.startsWith('SELECT influencer_id FROM payout_accounts')) return [[], []];
        if (sql.startsWith('INSERT INTO payout_accounts')) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        throw new Error(`Unexpected query: ${sql}`);
      },
    })) as unknown as typeof pool.connect;
    const token = jwt.sign({ id, role: 'INFLUENCER', storeId: null }, process.env.JWT_SECRET);
    const result = await request(buildApp()).put('/influencer/payout-account').set('authorization', `Bearer ${token}`)
      .send({ currentPassword: 'old-password-123', accountHolder: 'Creator', accountNumber: '123456789', ifsc: 'HDFC0001234' }).expect(409);
    assert.equal(result.body.code, 'BANK_IN_USE');
    assert.equal(rolledBack, true);
    assert.equal(committed, false);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    if (oldKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = oldKey;
    await pool.end();
  }
});
