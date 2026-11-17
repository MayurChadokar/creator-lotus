// Daily housekeeping (02:00 India). Once a day keeps the free plan's database credits safe: post checks, campaign expiry, tiers, and the daily draft payment sheet.

export default async () => {
  if (!process.env.DATABASE_URL && !process.env.MYSQL_URL) throw new Error('DATABASE_URL must point to a MySQL 8 database');
  process.env.DB_POOL_SIZE ??= '3';
  const { runJobs } = await import('../../backend/src/engines/jobs.ts');
  console.log(JSON.stringify(await runJobs()));
};

export const config = { schedule: '30 20 * * *' };
