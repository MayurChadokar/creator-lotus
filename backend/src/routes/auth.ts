import bcrypt from 'bcryptjs';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import crypto from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { AppError, audit, decrypt, encrypt, env, forbidden, lookupHash, notify, pool, withTx } from '../core.js';
import { flushOutbox } from '../engines/notifications.js';

export interface SessionUser { id: string; role: 'ADMIN' | 'STORE_MANAGER' | 'INFLUENCER'; storeId: string | null }
declare module 'express-serve-static-core' { interface Request { user: SessionUser } }

/** Admin sessions are short because they can reach bank details. */
export const signSession = (u: SessionUser, tv = 0) =>
  jwt.sign({ ...u, tv }, env('JWT_SECRET'), { expiresIn: u.role === 'ADMIN' ? '4h' : '12h', algorithm: 'HS256' });

const MAX_FAILS_PER_ACCOUNT = 8;
const MAX_FAILS_PER_IP = 40;
const MAX_SIGNUPS_PER_IP = 10;
const count = async (key: string, minutes: number) =>
  (await pool.query(`SELECT COUNT(*)::int n FROM auth_attempts WHERE key=$1 AND at > now() - make_interval(mins => $2)`, [key, minutes])).rows[0].n as number;
const record = (...keys: string[]) => Promise.all(keys.map((k) => pool.query(`INSERT INTO auth_attempts (key) VALUES ($1)`, [k])));
const MAX_FAILS_ACCOUNT_ANYWHERE = 50;
const acctKey = (email: string) => `acct:${lookupHash(email)}`;
const acctIpKey = (email: string, req: Request) => `acctip:${lookupHash(`${email}|${req.ip ?? ''}`)}`;
const ipKey = (req: Request, kind = 'ip') => `${kind}:${lookupHash(req.ip ?? 'unknown')}`;
const assertNotLocked = async (req: Request, email: string) => {
  // Keyed to account + connection, so a stranger cannot lock out the real owner by guessing.
  if ((await count(acctIpKey(email, req), 15)) >= MAX_FAILS_PER_ACCOUNT || (await count(acctKey(email), 15)) >= MAX_FAILS_ACCOUNT_ANYWHERE || (await count(ipKey(req), 15)) >= MAX_FAILS_PER_IP) {
    throw new AppError(429, 'LOCKED', 'Too many attempts. Please wait 15 minutes and try again.');
  }
};
const totpFor = (secretBase32: string, label: string) =>
  new TOTP({ issuer: process.env.BRAND_NAME ?? 'Lotus Electronics Supermarket', label, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });
const signMfa = (id: string, tv: number) => jwt.sign({ uid: id, tv, purpose: 'mfa' }, env('JWT_SECRET'), { expiresIn: '10m', algorithm: 'HS256' });
async function readMfa(token: string) {
  let p: { uid?: string; tv?: number; purpose?: string };
  try { p = jwt.verify(token, env('JWT_SECRET'), { algorithms: ['HS256'] }) as typeof p; } catch { throw new AppError(401, 'MFA_EXPIRED', 'Please log in again.'); }
  if (p.purpose !== 'mfa' || !p.uid) throw new AppError(401, 'MFA_EXPIRED', 'Please log in again.');
  const { rows: [u] } = await pool.query(`SELECT * FROM users WHERE id=$1`, [p.uid]);
  if (!u?.is_active || u.token_version !== p.tv || u.role !== 'ADMIN') throw new AppError(401, 'MFA_EXPIRED', 'Please log in again.');
  return u;
}
const sessionFor = (u: any) => signSession({ id: u.id, role: u.role, storeId: u.store_id }, u.token_version);

/** Lets a request through only with a valid login of an allowed role. Rechecks the account is still active. */
export const requireRole = (...roles: SessionUser['role'][]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.header('authorization')?.replace(/^Bearer /, '');
    if (!token) throw new AppError(401, 'NOT_LOGGED_IN', 'Please log in');
    let u: SessionUser;
    try {
      u = jwt.verify(token, env('JWT_SECRET'), { algorithms: ['HS256'] }) as SessionUser;
    } catch {
      throw new AppError(401, 'NOT_LOGGED_IN', 'Your session has ended. Please log in again.');
    }
    const claims = u as SessionUser & { tv?: number; purpose?: string };
    if (!u.id || claims.purpose) throw new AppError(401, 'NOT_LOGGED_IN', 'Please log in');
    const { rows: [db] } = await pool.query(`SELECT is_active, role, store_id, token_version, must_change_password FROM users WHERE id=$1`, [u.id]);
    if (db && db.token_version !== (claims.tv ?? 0)) throw new AppError(401, 'NOT_LOGGED_IN', 'Your session has ended. Please log in again.');
    if (!db?.is_active) throw new AppError(401, 'NOT_LOGGED_IN', 'This account is disabled');
    if (!roles.includes(db.role)) throw forbidden();
    if (db.must_change_password && !req.originalUrl.split('?')[0]!.endsWith('/auth/change-password')) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Please choose your own password first');
    }
    req.user = { id: u.id, role: db.role, storeId: db.store_id };
    next();
  };

/** One-time reset link. Only a hash is stored, so reading the database reveals nothing usable. */
export async function createResetLink(userId: string, createdBy: string | null, hours: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(`UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL`, [userId]);
  await pool.query(`INSERT INTO password_resets (user_id, token_hash, expires_at, created_by) VALUES ($1,$2, now()+make_interval(hours => $3), $4)`, [userId, lookupHash(token), hours, createdBy]);
  await audit(pool, createdBy, 'PASSWORD_RESET_LINK_CREATED', 'user', userId);
  return `${process.env.PUBLIC_URL ?? process.env.URL ?? ''}/reset?token=${token}`;
}

const password = z.string().min(10, 'Use at least 10 characters').max(72, 'Use 72 characters or fewer');

/** What anyone can see before logging in. */
export function publicRoutes() {
  const r = Router();
  r.get('/stores', async (_q, res) => {
    res.json((await pool.query(`SELECT id, name, city FROM stores WHERE is_active ORDER BY city, name`)).rows);
  });
  r.get('/categories', async (_q, res) => {
    res.json((await pool.query(`SELECT id, name FROM product_categories ORDER BY name`)).rows);
  });
  r.get('/campaigns', async (_q, res) => {
    const { rows } = await pool.query(
      `SELECT k.id, k.title, k.brief, k.expires_at, pc.name category,
              (SELECT string_agg(DISTINCT s.city, ', ') FROM campaign_stores cs JOIN stores s ON s.id=cs.store_id WHERE cs.campaign_id=k.id) cities
         FROM campaigns k JOIN product_categories pc ON pc.id=k.category_id
        WHERE k.status='OPEN' AND k.starts_at<=now() AND k.expires_at>now() ORDER BY k.expires_at LIMIT 12`);
    res.json(rows);
  });
  return r;
}

export function authRoutes() {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

  r.post('/register', limiter, async (req, res) => {
    if ((await count(ipKey(req, 'signup'), 60)) >= MAX_SIGNUPS_PER_IP) throw new AppError(429, 'LOCKED', 'Too many sign-ups from this connection. Please try again later.');
    const b = z.object({
      fullName: z.string().min(2).max(120), email: z.string().email(), phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'),
      password, city: z.string().max(80).optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
      homeStoreId: z.string().uuid(), acceptPrivacy: z.literal(true, { message: 'Please agree to the privacy policy' }),
    }).parse(req.body);
    const hash = await bcrypt.hash(b.password, 12);
    const id = await withTx(async (c) => {
      const { rows: [u] } = await c.query(
        `INSERT INTO users (role, full_name, email, phone, password_hash) VALUES ('INFLUENCER',$1,$2,$3,$4) RETURNING id`,
        [b.fullName, b.email.toLowerCase(), b.phone, hash]);
      await c.query(
        `INSERT INTO influencer_profiles (user_id, tier_id, city, latitude, longitude, home_store_id, privacy_accepted_at)
         VALUES ($1, (SELECT id FROM tiers ORDER BY rank LIMIT 1), $2,$3,$4,$5, now())`,
        [u.id, b.city ?? null, b.latitude ?? null, b.longitude ?? null, b.homeStoreId]);
      await notify(c, u.id, 'creator_registered');
      return u.id as string;
    });
    await record(ipKey(req, 'signup'));
    await flushOutbox().catch(() => console.error('Email queue could not be processed after registration'));
    res.status(201).json({ token: signSession({ id, role: 'INFLUENCER', storeId: null }) });
  });

  r.post('/change-password', limiter, requireRole('ADMIN', 'STORE_MANAGER', 'INFLUENCER'), async (req, res) => {
    const b = z.object({ current: z.string(), next: password }).parse(req.body);
    const { rows: [u] } = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
    if (!(await bcrypt.compare(b.current, u.password_hash))) throw new AppError(400, 'BAD_PASSWORD', 'Your current password is not right');
    // Logs out every other device, in case the old password was stolen.
    const { rows: [n] } = await pool.query(`UPDATE users SET password_hash=$2, must_change_password=FALSE, token_version=token_version+1 WHERE id=$1 RETURNING *`, [req.user.id, await bcrypt.hash(b.next, 12)]);
    await audit(pool, req.user.id, 'PASSWORD_CHANGED', 'user', req.user.id);
    await notify(pool, req.user.id, 'password_changed');
    await flushOutbox();
    res.json({ token: sessionFor(n), role: n.role });
  });

  // Forgotten password. The answer is the same whether or not the email exists.
  r.post('/forgot-password', limiter, async (req, res) => {
    const b = z.object({ email: z.string().email() }).parse(req.body);
    const email = b.email.toLowerCase();
    const key = `forgot:${lookupHash(email)}`;
    if ((await count(key, 60)) < 3 && (await count(ipKey(req, 'forgot'), 60)) < 20) {
      await record(key, ipKey(req, 'forgot'));
      const { rows: [u] } = await pool.query(`SELECT id FROM users WHERE email=$1 AND is_active`, [email]);
      if (u) {
        const link = await createResetLink(u.id, null, 1);
        await notify(pool, u.id, 'password_reset', { linkEnc: encrypt(link) });
        await flushOutbox().catch(() => console.error('Email queue could not be processed after password reset request'));
      }
    }
    res.json({ ok: true });
  });
  r.post('/reset-password', limiter, async (req, res) => {
    const b = z.object({ token: z.string().min(20).max(200), password }).parse(req.body);
    const u = await withTx(async (c) => {
      const { rows: [t] } = await c.query(
        `SELECT * FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [lookupHash(b.token)]);
      if (!t) throw new AppError(400, 'BAD_TOKEN', 'This link has expired or was already used. Please ask for a new one.');
      await c.query(`UPDATE password_resets SET used_at=now() WHERE id=$1`, [t.id]);
      const { rows: [n] } = await c.query(
        `UPDATE users SET password_hash=$2, must_change_password=FALSE, token_version=token_version+1 WHERE id=$1 AND is_active RETURNING id, role`, [t.user_id, await bcrypt.hash(b.password, 12)]);
      if (!n) throw new AppError(400, 'BAD_TOKEN', 'This account is disabled.');
      // A reset is the classic takeover route: payments pause until an admin re-confirms the bank details.
      await c.query(`UPDATE payout_accounts SET verified_at=NULL, verified_by=NULL WHERE influencer_id=$1`, [t.user_id]);
      await audit(c, t.user_id, 'PASSWORD_RESET_USED', 'user', t.user_id);
      await notify(c, t.user_id, 'password_changed');
      return n;
    });
    await flushOutbox();
    res.json({ ok: true, role: u.role });
  });

  r.post('/login', limiter, async (req, res) => {
    const b = z.object({ email: z.string().email(), password: z.string().max(200) }).parse(req.body);
    const email = b.email.toLowerCase();
    await assertNotLocked(req, email);
    const { rows: [u] } = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);
    // Same message and timing whether or not the email exists
    const ok = await bcrypt.compare(b.password, u?.password_hash ?? '$2a$12$CwTycUXWue0Thq9StjUM0uJ8wYwPm2Z3CZ4sU0y4XvQ7h1m7yYv9e');
    if (!u || !ok || !u.is_active) {
      await record(acctIpKey(email, req), acctKey(email), ipKey(req));
      throw new AppError(401, 'BAD_LOGIN', 'Wrong email or password');
    }
    // Only the exact word 'off' disables it, so a missing or mistyped setting keeps it on.
    if (u.role === 'ADMIN' && process.env.ADMIN_TWO_STEP !== 'off') {
      res.json({ mfaToken: signMfa(u.id, u.token_version), mfa: u.mfa_enabled_at ? 'VERIFY' : 'SETUP' });
      return;
    }
    await pool.query(`DELETE FROM auth_attempts WHERE key = ANY($1)`, [[acctKey(email), acctIpKey(email, req)]]);
    res.json({ token: sessionFor(u), role: u.role, name: u.full_name });
  });

  // Admin first login: scan the code into an authenticator app
  r.post('/mfa/setup', limiter, async (req, res) => {
    const b = z.object({ mfaToken: z.string() }).parse(req.body);
    const u = await readMfa(b.mfaToken);
    if (u.mfa_enabled_at) throw new AppError(409, 'MFA_ON', 'Two-step login is already on.');
    const secret = new Secret({ size: 20 }).base32;
    await pool.query(`UPDATE users SET totp_secret_enc=$2 WHERE id=$1`, [u.id, encrypt(secret)]);
    const uri = totpFor(secret, u.email).toString();
    res.json({ secret, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
  });
  r.post('/mfa/enable', limiter, async (req, res) => {
    const b = z.object({ mfaToken: z.string(), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).parse(req.body);
    const u = await readMfa(b.mfaToken);
    await assertNotLocked(req, u.email);
    if (u.mfa_enabled_at || !u.totp_secret_enc) throw new AppError(409, 'MFA_STATE', 'Please log in again.');
    if (totpFor(decrypt(u.totp_secret_enc), u.email).validate({ token: b.code, window: 1 }) === null) {
      await record(acctIpKey(u.email, req), acctKey(u.email), ipKey(req));
      throw new AppError(400, 'BAD_CODE', 'That code is not right. Try the newest code.');
    }
    const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
    await pool.query(`UPDATE users SET mfa_enabled_at=now(), recovery_hashes=$2 WHERE id=$1`, [u.id, JSON.stringify(codes.map((c) => lookupHash(c)))]);
    await audit(pool, u.id, 'MFA_ENABLED', 'user', u.id);
    res.json({ token: sessionFor(u), role: u.role, name: u.full_name, recoveryCodes: codes });
  });
  r.post('/mfa/verify', limiter, async (req, res) => {
    const b = z.object({ mfaToken: z.string(), code: z.string().trim().min(6).max(20) }).parse(req.body);
    const u = await readMfa(b.mfaToken);
    await assertNotLocked(req, u.email);
    if (!u.mfa_enabled_at) throw new AppError(409, 'MFA_STATE', 'Please log in again.');
    const code = b.code.toLowerCase();
    let good = false;
    if (/^\d{6}$/.test(code)) {
      const delta = totpFor(decrypt(u.totp_secret_enc), u.email).validate({ token: code, window: 1 });
      if (delta !== null) {
        const step = Math.floor(Date.now() / 30000) + delta;
        // Each code works once, even inside its 30-second window.
        const used = await pool.query(`UPDATE users SET last_totp_step=$2 WHERE id=$1 AND (last_totp_step IS NULL OR last_totp_step < $2)`, [u.id, step]);
        good = !!used.rowCount;
      }
    }
    if (!good && /^[0-9a-f]{10}$/.test(code)) {
      const recoveryHash = lookupHash(code);
      const used = await pool.query(
        `UPDATE users SET recovery_hashes=JSON_REMOVE(recovery_hashes, JSON_UNQUOTE(JSON_SEARCH(recovery_hashes,'one',$2)))
          WHERE id=$1 AND JSON_SEARCH(recovery_hashes,'one',$2) IS NOT NULL`, [u.id, recoveryHash]);
      good = !!used.rowCount;
      if (good) await audit(pool, u.id, 'MFA_RECOVERY_CODE_USED', 'user', u.id);
    }
    if (!good) {
      await record(acctIpKey(u.email, req), acctKey(u.email), ipKey(req));
      throw new AppError(400, 'BAD_CODE', 'That code is not right. Try the newest code.');
    }
    await pool.query(`DELETE FROM auth_attempts WHERE key = ANY($1)`, [[acctKey(u.email), acctIpKey(u.email, req)]]);
    res.json({ token: sessionFor(u), role: u.role, name: u.full_name });
  });
  return r;
}
