import bcrypt from 'bcryptjs';
import cors from 'cors';
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { AppError, env, pool } from './core.js';
import { runJobs } from './engines/jobs.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes, publicRoutes } from './routes/auth.js';
import { influencerRoutes } from './routes/influencer.js';
import { managerRoutes } from './routes/manager.js';

const sameSecret = (a: string, b: string) => {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
};

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean) }));

  app.use((_q, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }); // never cache personal data
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', async (_q, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
  app.post('/internal/run-jobs', async (req, res) => {
    if (!sameSecret(req.header('x-jobs-secret') ?? '', env('JOBS_SECRET'))) {
      res.status(401).json({ error: 'Not allowed' });
      return;
    }
    res.json(await runJobs());
  });
  // One-time creation of the first admin on a new database. Refuses once any admin exists.
  app.post('/internal/first-admin', async (req, res) => {
    if (!sameSecret(req.header('x-jobs-secret') ?? '', env('JOBS_SECRET'))) {
      res.status(401).json({ error: 'Not allowed' });
      return;
    }
    const { email, password, fullName } = req.body ?? {};
    if (!email || !password || String(password).length < 10) { res.status(400).json({ error: 'email and a 10+ character password are required' }); return; }
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO users (role, full_name, email, password_hash)
       SELECT 'ADMIN',$1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='ADMIN') RETURNING id`,
      [fullName ?? 'Platform Admin', String(email).toLowerCase(), hash]);
    res.status(r.rowCount ? 201 : 409).json({ created: !!r.rowCount });
  });
  app.use('/public', publicRoutes());
  app.use('/auth', authRoutes());
  app.use('/influencer', influencerRoutes());
  app.use('/manager', managerRoutes());
  app.use('/admin', adminRoutes());

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) { res.status(err.status).json({ code: err.code, error: err.message }); return; }
    if (err instanceof ZodError) { res.status(400).json({ code: 'INVALID_INPUT', error: 'Please check the form', fields: err.flatten().fieldErrors }); return; }
    const msg = (err as { message?: string }).message ?? '';
    if (msg.includes('ONE_ENTRY_PER_CAMPAIGN') || msg.includes('ONE_PAYMENT_PER_CAMPAIGN')) {
      res.status(409).json({ code: 'ONE_ENTRY_PER_CAMPAIGN', error: 'This creator already has a post in this campaign. Each creator is paid once per campaign.' }); return;
    }
    if ((err as { code?: string }).code === '23505' && msg.includes('account_lookup_hash')) {
      res.status(409).json({ code: 'BANK_IN_USE', error: 'This bank account is already used by another creator. Please use your own account.' }); return;
    }
    if ((err as { code?: string }).code === '23505') { res.status(409).json({ code: 'DUPLICATE', error: 'This record already exists' }); return; }
    console.error(err);
    res.status(500).json({ code: 'SERVER_ERROR', error: 'Something went wrong. Please try again.' });
  });
  return app;
}
