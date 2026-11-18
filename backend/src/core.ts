// Shared foundations: settings, database connection, errors, encryption, dates.
import 'dotenv/config';
import crypto from 'node:crypto';
import mysql, { type Pool as RawPool, type PoolConnection } from 'mysql2/promise';

export const env = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing setting: ${name}`);
  return v;
};

export type QueryResult<T = any> = { rows: T[]; rowCount: number };
export interface Db { query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>> }

/** Keeps the existing query call-sites readable while translating their parameter syntax to MySQL. */
function mysqlQuery(sql: string, params: unknown[]) {
  const ordered: unknown[] = [];
  const intervalUnits: Record<string, string> = {
    mins: 'MINUTE',
    hours: 'HOUR',
    days: 'DAY',
    secs: 'SECOND',
  };
  let q = sql.replace(/\$([1-9]\d*)/g, (_m, n) => {
    ordered.push(params[Number(n) - 1]);
    return '?';
  });
  q = q
    .replace(/(?<!`)\b(rank|key)\b(?!`)/gi, '`$1`')
    .replace(/\(now\(\) AT TIME ZONE 'Asia\/Kolkata'\)::date/gi, 'CURRENT_DATE()')
    .replace(/\bnow\(\)\s*-\s*INTERVAL\s+'(\d+)\s+(day|days|hour|hours|minute|minutes)'/gi,
      (_m, amount, unit) => `DATE_SUB(NOW(), INTERVAL ${amount} ${String(unit).replace(/s$/i, '').toUpperCase()})`)
    .replace(/\bnow\(\)\s*\+\s*INTERVAL\s+'(\d+)\s+(day|days|hour|hours|minute|minutes)'/gi,
      (_m, amount, unit) => `DATE_ADD(NOW(), INTERVAL ${amount} ${String(unit).replace(/s$/i, '').toUpperCase()})`)
    .replace(/\bnow\(\)\s*-\s*make_interval\((mins|hours|days|secs)\s*=>\s*\?\)/gi, (_m, unit) => `DATE_SUB(NOW(), INTERVAL ? ${intervalUnits[String(unit).toLowerCase()]})`)
    .replace(/\bnow\(\)\s*\+\s*make_interval\((mins|hours|days|secs)\s*=>\s*\?\)/gi, (_m, unit) => `DATE_ADD(NOW(), INTERVAL ? ${intervalUnits[String(unit).toLowerCase()]})`)
    .replace(/\bnow\(\)\s*\+\s*make_interval\((mins|hours|days|secs)\s*=>\s*(\w+)\)/gi, (_m, unit, value) => `DATE_ADD(NOW(), INTERVAL ${value} ${intervalUnits[String(unit).toLowerCase()]})`)
    .replace(/to_char\(([^,]+),\s*'YYYY-MM-DD'\)/gi, "DATE_FORMAT($1,'%Y-%m-%d')")
    .replace(/::(?:bigint|int|integer|text|uuid|boolean)(?:\[\])?/gi, '')
    .replace(/\bFOR UPDATE OF\s+\w+/gi, 'FOR UPDATE')
    .replace(/\s+NULLS\s+(?:FIRST|LAST)/gi, '')
    .replace(/\b(\w+(?:\.\w+)?)\s+IS DISTINCT FROM\s+\?/gi, 'NOT ($1 <=> ?)')
    .replace(/(`\w+`|\w+(?:\.\w+)?)\s*=\s*ANY\(\?\)/gi, '$1 IN (?)')
    .replace(/\barray_agg\(/gi, 'JSON_ARRAYAGG(')
    .replace(/\bjson_agg\(/gi, 'JSON_ARRAYAGG(')
    .replace(/\bjson_build_object\(/gi, 'JSON_OBJECT(')
    .replace(/string_agg\(DISTINCT\s+([^,]+),\s*'([^']*)'\)/gi, "GROUP_CONCAT(DISTINCT $1 SEPARATOR '$2')")
    .replace(/ON CONFLICT\s*\(([^)]+)\)\s*DO NOTHING/gi, (_m, keys) => {
      const key = String(keys).split(',')[0].trim();
      return `ON DUPLICATE KEY UPDATE ${key}=${key}`;
    })
    .replace(/ON CONFLICT\s*\([^)]+\)\s*DO UPDATE SET\s+([\s\S]+)$/gi,
      (_m, updates) => `ON DUPLICATE KEY UPDATE ${String(updates).replace(/EXCLUDED\.(\w+)/gi, 'VALUES($1)')}`);
  return { sql: q, params: ordered };
}

class MysqlDatabase implements Db {
  constructor(private raw: RawPool | PoolConnection) {}

  async query<T = any>(source: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const returning = source.match(/\s+RETURNING\s+([\s\S]+?)\s*;?$/i);
    let beforeRows: T[] | undefined;
    let generatedId: string | undefined;

    if (returning && /^\s*UPDATE\s+/i.test(source)) {
      const parts = source.match(/^\s*UPDATE\s+(\w+)\s+SET[\s\S]+?\s+WHERE\s+([\s\S]+?)\s+RETURNING\s+/i);
      if (parts) {
        const select = mysqlQuery(`SELECT ${returning[1]} FROM ${parts[1]} WHERE ${parts[2]}`, params);
        const [rows] = await this.raw.query(select.sql, select.params as any[]);
        beforeRows = rows as T[];
      }
    }

    if (returning && /^\s*INSERT\s+/i.test(source)) {
      const head = source.match(/^(\s*INSERT\s+INTO\s+\w+\s*)\(([^)]+)\)/i);
      if (head && !head[2].split(',').some((c) => c.trim().toLowerCase() === 'id')) {
        generatedId = crypto.randomUUID();
        const marker = `$${params.length + 1}`;
        source = source.replace(head[0], `${head[1]}(id,${head[2]})`);
        source = source.replace(/\bVALUES\s*\(/i, `VALUES (${marker},`);
        if (!/\bVALUES\s*\(/i.test(source.slice(0, returning.index))) {
          source = source.replace(/\bSELECT\s+/i, `SELECT ${marker},`);
        }
        params = [...params, generatedId];
      }
    }

    if (returning) source = source.slice(0, source.lastIndexOf(returning[0])).trim();
    const converted = mysqlQuery(source, params);
    const [result] = await this.raw.query(converted.sql, converted.params as any[]);
    const affected = Number((result as any).affectedRows ?? 0);

    if (returning) {
      if (beforeRows) return { rows: affected ? beforeRows.slice(0, affected) : [], rowCount: affected };
      const table = source.match(/^\s*INSERT\s+INTO\s+(\w+)/i)?.[1];
      if (table && generatedId && affected) {
        const [rows] = await this.raw.query(`SELECT ${returning[1]} FROM ${table} WHERE id=?`, [generatedId]);
        return { rows: rows as T[], rowCount: (rows as T[]).length };
      }
      return { rows: [], rowCount: affected };
    }
    const rows = Array.isArray(result) ? result as T[] : [];
    return { rows, rowCount: Array.isArray(result) ? rows.length : affected };
  }
}

const connectionString = process.env.DATABASE_URL ?? env('MYSQL_URL');
const rawPool = mysql.createPool({
  uri: connectionString,
  connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  multipleStatements: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  timezone: 'Z',
  typeCast(field, next) {
    if (field.type === 'JSON') {
      const value = field.string('utf8');
      return value === null ? null : JSON.parse(value);
    }
    return next();
  },
});

export const pool: Db & { connect(): Promise<PoolConnection>; end(): Promise<void> } = Object.assign(
  new MysqlDatabase(rawPool),
  { connect: () => rawPool.getConnection(), end: () => rawPool.end() },
);

/** Runs work as all-or-nothing: any error undoes every change made inside. */
export async function withTx<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const raw = await pool.connect();
  const c = new MysqlDatabase(raw);
  try {
    await raw.beginTransaction();
    const out = await fn(c);
    await raw.commit();
    return out;
  } catch (e) {
    await raw.rollback();
    throw e;
  } finally {
    raw.release();
  }
}

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have access to this') => new AppError(403, 'FORBIDDEN', msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);

export async function audit(
  db: Db, actorId: string | null, action: string, entityType: string, entityId: string,
  reason?: string | null, details: unknown = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [actorId, action, entityType, entityId, reason ?? null, JSON.stringify(details)],
  );
}

export async function notify(db: Db, userId: string, template: string, payload: object = {}): Promise<void> {
  await db.query(`INSERT INTO notifications_outbox (user_id, template, payload) VALUES ($1,$2,$3)`,
    [userId, template, JSON.stringify(payload)]);
}

// ---- Encryption (AES-256-GCM) for PAN, bank numbers and tokens ----
const key = () => {
  const k = Buffer.from(env('ENCRYPTION_KEY'), 'hex');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 64 hex characters');
  return k;
};
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}
export function decrypt(sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!), d.final()]).toString('utf8');
}
export const lookupHash = (v: string) => crypto.createHmac('sha256', key()).update(v).digest('hex');

// ---- India dates and working days ----
/** Calendar date in India as YYYY-MM-DD. */
export const istDate = (d: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

/** Indian tax year for a date: 2026-11-03 gives '2026-27'. */
export function taxYear(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Adds working days, skipping Saturdays, Sundays and listed bank holidays. */
export function addWorkingDays(isoDate: string, days: number, holidays: Set<string>): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(d.toISOString().slice(0, 10))) left--;
  }
  return d.toISOString().slice(0, 10);
}
export async function loadHolidays(db: Db): Promise<Set<string>> {
  const r = await db.query(`SELECT to_char(holiday_date,'YYYY-MM-DD') d FROM bank_holidays`);
  return new Set(r.rows.map((x) => x.d as string));
}
