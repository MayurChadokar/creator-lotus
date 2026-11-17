# MySQL 8 setup

The backend now expects MySQL 8.0 or newer.

1. Create an empty database using `utf8mb4`.
2. Set `DATABASE_URL=mysql://user:password@host:3306/database`.
3. Set the remaining values from `backend/.env.example`.
4. Run `cd backend && npm install && npm run db:setup`.
5. Start the API with `npm run dev` or deploy it through Netlify.

Netlify Database is PostgreSQL-only, so deployment must use an external MySQL service such as Amazon RDS, Aiven, DigitalOcean, Railway, or PlanetScale. Add `DATABASE_URL` and, when required by the provider, `DATABASE_SSL=true` to the Netlify environment.

## Existing PostgreSQL data

Schema conversion and data transfer are separate operations. Run the MySQL setup against an empty target first, then migrate table data with a migration tool such as AWS DMS or `pgloader`, preserving UUID strings and converting PostgreSQL arrays to JSON arrays. Do not import the PostgreSQL trigger/function definitions; the MySQL equivalents are installed from `backend/db/schema.mysql.triggers.sql`.
