import { pool } from './core.js';
import { runJobs } from './engines/jobs.js';
console.log(JSON.stringify(await runJobs(), null, 2));
await pool.end();
