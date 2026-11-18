# MySQL integration testing

The flow tests reset every table in the configured database. Never point them at production or a database containing useful data. They now refuse to reset unless `ALLOW_DESTRUCTIVE_TESTS=1` and the selected database name contains `test` as a separate underscore-delimited word (for example `lotus_test`).

Create a separate empty MySQL 8 database and a test-only account with access only to that database. Create a local, untracked `.env.test` in `backend` containing `DATABASE_URL`, `JWT_SECRET`, and a 64-character hexadecimal `ENCRYPTION_KEY` for that isolated database. Never copy production credentials or secrets into it.

From `backend` on Windows PowerShell, run:

```powershell
$env:ALLOW_DESTRUCTIVE_TESTS = '1'
node --env-file=.env.test --import tsx --test --test-concurrency=1 tests/flow.test.ts
Remove-Item Env:ALLOW_DESTRUCTIVE_TESTS
```

On Linux:

```bash
ALLOW_DESTRUCTIVE_TESTS=1 node --env-file=.env.test --import tsx --test --test-concurrency=1 tests/flow.test.ts
```

Ensure `DATABASE_URL` is not already set in the shell to another database: Node's environment file does not override existing environment variables. Confirm the target separately without printing credentials before running. The tests create, modify and delete test records and tables.
