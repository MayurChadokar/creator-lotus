import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/core.js';

test('campaign creation and posting updates bind JSON arrays as single MySQL values', async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const originalSecret = process.env.JWT_SECRET;
  const calls: { sql: string; values: any[] }[] = [];
  const adminId = '11111111-1111-4111-8111-111111111111';
  const storeId = '22222222-2222-4222-8222-222222222222';
  const categoryId = '33333333-3333-4333-8333-333333333333';
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt';
  try {
    pool.query = (async (sql: string, values: any[] = []) => {
      if (sql.includes('SELECT is_active, role')) return { rows: [{ is_active: true, role: 'ADMIN', token_version: 0, must_change_password: false }], rowCount: 1 };
      calls.push({ sql, values });
      return { rows: [], rowCount: 1 };
    }) as typeof pool.query;
    pool.connect = (async () => ({
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
      query: async (sql: string, values: any[]) => {
        calls.push({ sql, values });
        if (sql.startsWith('SELECT id FROM campaigns')) return [[{ id: values[0] }], []];
        return [{ affectedRows: 1 }, []];
      },
    })) as unknown as typeof pool.connect;
    const authorization = `Bearer ${jwt.sign({ id: adminId, role: 'ADMIN', storeId: null }, process.env.JWT_SECRET)}`;
    const app = buildApp();
    const data = { title: 'Test campaign', brief: 'Campaign description', categoryId, storeIds: [storeId], startsAt: '2030-01-01T00:00:00.000Z', expiresAt: '2030-02-01T00:00:00.000Z', budgetPaise: 250000, submissionQuota: 1 };
    for (const specs of [{}, { postingHashtags: ['#Lotus'], postingMentions: ['@lotus'] }]) {
      await request(app).post('/admin/campaigns').set('authorization', authorization).send({ ...data, ...specs }).expect(201);
    }
    const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO campaigns'));
    assert.equal(inserts.length, 2);
    assert.ok(inserts[0]!.values.includes('[]'));
    assert.ok(inserts[1]!.values.includes('["#Lotus"]'));
    for (const call of inserts) assert.doesNotMatch(mysql.format(call.sql, call.values), /,,/);
    await request(app).put(`/admin/campaigns/${storeId}/posting`).set('authorization', authorization)
      .send({ postingHashtags: ['#Lotus'], postingMentions: ['@lotus'] }).expect(200);
    const update = calls.find((c) => c.sql.startsWith('UPDATE campaigns SET posting_hashtags'))!;
    assert.equal(update.values[1], '["#Lotus"]');
    assert.equal(update.values[2], '["@lotus"]');
    for (const value of [0, 1]) {
      await request(app).put(`/admin/campaigns/${storeId}/posting`).set('authorization', authorization)
        .send({ requiredDisclosure: value }).expect(200);
      const lastUpdate = calls.filter((c) => c.sql.startsWith('UPDATE campaigns SET posting_hashtags')).at(-1)!;
      assert.equal(lastUpdate.values[5], Boolean(value));
    }
    await request(app).put(`/admin/campaigns/${storeId}/posting`).set('authorization', authorization)
      .send({ requiredDisclosure: 'false' }).expect(400);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
    await pool.end();
  }
});
