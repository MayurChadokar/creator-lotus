import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/core.js';

test('password change returns a session with the updated token version', async () => {
  const originalQuery = pool.query;
  const oldSecret = process.env.JWT_SECRET;
  const oldProvider = process.env.EMAIL_PROVIDER;
  const id = '11111111-1111-4111-8111-111111111111';
  const hash = await bcrypt.hash('old-password-123', 4);
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt';
  process.env.EMAIL_PROVIDER = 'disabled';
  let version = 0;
  try {
    pool.query = (async (sql: string) => {
      if (sql.startsWith('SELECT is_active, role')) return { rows: [{ is_active: 1, role: 'INFLUENCER', token_version: version, must_change_password: false }], rowCount: 1 };
      if (sql.startsWith('SELECT password_hash')) return { rows: [{ password_hash: hash }], rowCount: 1 };
      if (sql.startsWith('UPDATE users SET password_hash')) { version++; return { rows: [], rowCount: 1 }; }
      if (sql.startsWith('SELECT * FROM users')) return { rows: [{ id, role: 'INFLUENCER', store_id: null, token_version: version }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) as typeof pool.query;
    const token = jwt.sign({ id, role: 'INFLUENCER', storeId: null }, process.env.JWT_SECRET);
    const result = await request(buildApp()).post('/auth/change-password').set('authorization', `Bearer ${token}`)
      .send({ current: 'old-password-123', next: 'new-password-123' }).expect(200);
    assert.equal((jwt.verify(result.body.token, process.env.JWT_SECRET) as { tv: number }).tv, 1);
  } finally {
    pool.query = originalQuery;
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    if (oldProvider === undefined) delete process.env.EMAIL_PROVIDER; else process.env.EMAIL_PROVIDER = oldProvider;
    await pool.end();
  }
});
