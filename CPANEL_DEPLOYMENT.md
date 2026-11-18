# Creator Lotus: cPanel deployment plan

Target: `https://creators.lotuselectronics.com`. This document is a deployment plan, not confirmation that the hosting environment or production release has been configured.

## Architecture

- Serve the Next.js static export from the subdomain's document root.
- Run the Express backend as a managed Node.js application outside the public document root.
- Route `https://creators.lotuselectronics.com/api/*` to the backend, stripping `/api` before forwarding. The Express routes start at `/auth`, `/public`, `/influencer`, etc.; Netlify's function adapter currently performs this stripping, but cPanel does not automatically do so.
- Use a separate MySQL 8 database with a dedicated least-privilege user. Never expose the database or application secrets through the web root.
- Schedule the backend jobs on the server, once daily at 02:00 Asia/Kolkata, after verifying the server's cron timezone.

## Prerequisites to confirm with the hosting provider

Node.js 22, MySQL 8, SSH or equivalent build access, Node application management (Passenger/Setup Node.js App), HTTPS, scheduled jobs, backups and a supported reverse proxy or equivalent same-origin `/api` routing. The exact application startup file, port handling, proxy rules and static route fallback depend on the host; do not assume a generic `.htaccess` rule can configure Passenger or reverse proxying on every shared host.

## Deployment sequence

1. Provision a staging subdomain and a separate empty staging database. Back up existing resources before changes. Do not use `db:demo` against production.
2. Install dependencies from the committed lockfiles and build with Node 22. The frontend uses `output: 'export'` and emits `frontend/out`. Build with `NEXT_PUBLIC_API_URL=/api` set in the build environment, and verify no `.env.local` overrides it. Do not use `localhost:4000` in the production frontend.
3. Build the backend with `npm run build` in `backend`. Install production dependencies and retain the backend `db/` SQL files for setup. Configure the host's Node application startup according to its Passenger/Node support; verify its allocated port and startup behavior. The local `npm run dev` watcher is not a production process manager.
4. Configure private runtime environment variables using `backend/.env.example` as the inventory: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `JOBS_SECRET`, `PUBLIC_URL`, `CORS_ORIGINS` and integration settings. Use independent strong secrets for a fresh deployment; do not commit or share them. For data migrated from an existing database, preserve the original encryption key securely or encrypted PAN and bank details cannot be read.
5. Initialize only the intended empty database using the documented setup process and provision the initial admin securely. Confirm legal terms, rates, tax settings and real store data before use. Do not run sample seed scripts against live data.
6. Deploy `frontend/out` to the staging document root. Configure static export routes so direct requests and refreshes of `/login`, `/creator/profile` and other routes serve their exported HTML files, while `/api/*` reaches the backend rather than the static fallback. Preserve appropriate security headers and HTTPS.
7. Configure the daily job using the built backend, e.g. the host's Node executable running `dist/runJobs.js` from the backend working directory, with the same private environment. Ensure jobs cannot overlap, capture logs and verify a scheduled execution in staging.
8. Verify `/api/health`, login, registration, creator profile, campaigns, visits, password reset, admin MFA, payment workflows and mobile layouts in staging. Verify CORS, TLS, direct-route refresh, backups and restore. External Instagram, YouTube and email features require their own configured credentials and provider approvals.
9. Add `creators.lotuselectronics.com` in cPanel and configure DNS at the authoritative DNS provider to the hosting server according to its instructions. Issue and verify TLS, promote the tested release and run smoke tests. Do not change the existing main-site DNS records.

## Operational cautions

- `ADMIN_TWO_STEP=off` disables admin MFA and is for testing only; do not set it in production.
- Seeded creator/manager credentials and `SAMPLE` campaigns are test data. Remove them through a reviewed migration or start a clean production database.
- Verify backup and restore procedures, including secure off-server storage of `ENCRYPTION_KEY`.
- Current local UI changes are not live until committed, pushed and deployed. The Git remote in this checkout must be confirmed as the repository actually connected to the target host; the existing Netlify site may use a different repository.
