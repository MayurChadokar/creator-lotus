// Creates all tables and starting data, plus the first admin. Safe to run more than once.
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { env, pool } from './core.js';

const read = (f: string) => readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8');

/** The canonical schema remains readable SQL; this maps its portable subset to MySQL 8 DDL. */
function toMysqlSchema(source: string): string {
  return source
    .split('CREATE FUNCTION forbid_audit_change()')[0]
    .replace(/^.*PostgreSQL 14\+.*$/m, '-- MySQL 8.0+')
    .replace(/^CREATE EXTENSION[^;]+;\s*/m, '')
    .replace(/\brank\b/gi, '`rank`')
    .replace(/(^\s*)key(\s+VARCHAR\(255\))/gim, '$1`key`$2')
    .replace(/\(key,/gi, '(`key`,')
    .replace(/\bTEXT\[\]/g, 'JSON')
    .replace(/\bUUID\b/g, 'CHAR(36)')
    .replace(/\bTIMESTAMPTZ\b/g, 'DATETIME(3)')
    .replace(/\bDOUBLE PRECISION\b/g, 'DOUBLE')
    .replace(/\bBIGSERIAL\b/g, 'BIGINT AUTO_INCREMENT')
    .replace(/\bJSONB\b/g, 'JSON')
    .replace(/JSON NOT NULL DEFAULT '\{\}'/g, 'JSON NOT NULL DEFAULT (JSON_OBJECT())')
    .replace(/DEFAULT\s+'\{\}'/g, "DEFAULT (JSON_ARRAY())")
    .replace(/DEFAULT\s+gen_random_uuid\(\)/g, 'DEFAULT (UUID())')
    .replace(/DEFAULT\s+now\(\)/gi, 'DEFAULT CURRENT_TIMESTAMP(3)')
    .replace(/\bBOOLEAN\b/g, 'TINYINT(1)')
    .replace(/DEFAULT TRUE/g, 'DEFAULT 1').replace(/DEFAULT FALSE/g, 'DEFAULT 0')
    .replace(/\bTEXT\b/g, 'VARCHAR(255)')
    .replace(/REFERENCES\s+([^\s,]+)\s+UNIQUE/g, 'UNIQUE REFERENCES $1')
    .replace(/(\bbody|\bbrief|\bdescription|\bposting_guidelines|\bstatus_reason|\bresolution_note|\bdecision_note|\breason|\bdetails)\s+VARCHAR\(255\)/g, '$1 TEXT')
    .replace(/CHECK \(start_time ~ '[^']+'\)/g, "CHECK (start_time REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9]$')")
    .replace(/CHECK \(end_time ~ '[^']+'\)/g, "CHECK (end_time REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9]$')")
    // Partial indexes are represented by transactional application checks in MySQL.
    .replace(/CREATE UNIQUE INDEX one_current_legal_document[\s\S]*?;\s*/g, '')
    .replace(/CREATE UNIQUE INDEX one_submission_per_post[\s\S]*?;\s*/g, '')
    .replace(/CREATE UNIQUE INDEX one_live_earning_per_submission[\s\S]*?;\s*/g, '')
    .replace(/CREATE UNIQUE INDEX one_open_ad_right[\s\S]*?;\s*/g, '')
    .replace(/CREATE UNIQUE INDEX one_live_item_per_earning[\s\S]*?;\s*/g, '')
    .replace(/CREATE UNIQUE INDEX one_visit_per_creator_slot[\s\S]*?;\s*/g, '')
    .replace(/CREATE INDEX tds_ledger_year_idx[\s\S]*?;\s*/g, 'CREATE INDEX tds_ledger_year_idx ON tds_ledger (influencer_id, tax_year);\n')
    .replace(/CREATE INDEX benefit_year_idx[\s\S]*?;\s*/g, 'CREATE INDEX benefit_year_idx ON benefit_records (influencer_id, tax_year);\n');
}

export async function setupDatabase() {
  const { rows: [{ exists }] } = await pool.query<{ exists: number }>(
    `SELECT COUNT(*) AS exists FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='users'`);
  if (!Number(exists)) {
    await pool.query(toMysqlSchema(read('schema.sql')));
    await pool.query(read('schema.mysql.triggers.sql'));
  }
  await pool.query(read('seed.mysql.sql'));
}

if (process.argv[1]?.endsWith('dbSetup.ts') || process.argv[1]?.endsWith('dbSetup.js')) {
  await setupDatabase();
  const email = env('FIRST_ADMIN_EMAIL').toLowerCase();
  const hash = await bcrypt.hash(env('FIRST_ADMIN_PASSWORD'), 12);
  await pool.query(
    `INSERT IGNORE INTO users (role, full_name, email, password_hash) VALUES ('ADMIN','Platform Admin',$1,$2)`, [email, hash]);
  console.log('Database is ready.');
  await pool.end();
}
