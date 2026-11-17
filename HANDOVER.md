# Lotus Creator Platform: handover for the web developer

This is the creator (influencer) platform for Lotus Electronics Supermarket. It has three portals:

- **Admin**, at `/admin`
- **Store manager**, at `/manager` (store visits only)
- **Creator**, at `/creator`, with public sign-up at `/register`

It is a complete, separate application with its **own database**. It does not touch the lotuselectronics.com website or its database. The main website only needs a link to it.

It is live now at **https://venerable-lily-824b40.netlify.app**. The source code is at github.com/lotusaiemail/lotus-creator-platform, and Netlify redeploys automatically on every push to `main`.

---

## 1. Recommended: give it a Lotus web address (about 15 minutes, no code)

Keep it on Netlify, where it already runs, and give it a subdomain such as **creators.lotuselectronics.com**.

1. In Netlify, open the site **venerable-lily-824b40** and go to **Domain management**. Choose **Add a domain** and enter `creators.lotuselectronics.com`.
2. At the DNS provider for lotuselectronics.com, add one record:
   `CNAME  creators  →  venerable-lily-824b40.netlify.app`
3. Wait for DNS. Netlify issues the HTTPS certificate automatically.
4. In Netlify, go to **Site configuration → Environment variables** and set `PUBLIC_URL` to `https://creators.lotuselectronics.com`. Then trigger a redeploy. This variable is used in emailed links.
5. On lotuselectronics.com, add a normal link or button, for example in the header, the footer or a "Become a Lotus Creator" banner:
   - `https://creators.lotuselectronics.com/` for the public page with open campaigns and "Join as a creator"
   - `https://creators.lotuselectronics.com/register` to go straight to sign-up
   - `https://creators.lotuselectronics.com/login` for staff and creator login

**Do not put it inside an iframe.** The platform deliberately refuses to be framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), because it handles bank and PAN details. Use a normal link that opens the page.

The free Netlify plan is fine for testing. For real use, upgrade the Netlify team plan for more function time, database size and backups.

---

## 2. Alternative: host it on your own server

Only choose this if the company must run it on its own infrastructure.

**Needs:**
- Node.js 22
- PostgreSQL 16
- a web server such as nginx that serves the static frontend and forwards `/api/` to the backend

```bash
# Backend
cd backend
cp .env.example .env        # fill in every value (see section 3)
npm ci
npm run db:setup            # creates the tables and the starting data in an EMPTY database
npm run build && npm start  # API on port 4000 (or PORT)

# Frontend (a static site)
cd ../frontend
npm ci
NEXT_PUBLIC_API_URL=/api npx next build   # output in frontend/out
```

**nginx (outline):**

```nginx
server {
  server_name creators.lotuselectronics.com;
  root /srv/lotus-creators/frontend/out;
  location /api/ { proxy_pass http://127.0.0.1:4000/; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
  location / { try_files $uri $uri.html $uri/index.html =404; }
  # copy the security headers from netlify.toml ([[headers]] section)
}
```

**Daily job:** run `npm run jobs` in `backend/` once a day at 02:00 India time (cron `30 20 * * *` UTC). It checks posts, expires campaigns, updates creator levels and drafts the payment sheet.

**Moving the existing data off Netlify:**
1. Export the PostgreSQL data and transfer it to MySQL 8 with AWS DMS or `pgloader`; see `MYSQL_MIGRATION.md`.
2. Copy `ENCRYPTION_KEY` **exactly** from Netlify's environment variables. Without that same key, the stored PANs, bank account numbers and social tokens **cannot be read**.

---

## 3. Settings (environment variables)

The full list, with notes, is in `backend/.env.example` and `frontend/.env.example`. On Netlify they are set under **Site configuration → Environment variables**.

| Setting | Status | Notes |
|---|---|---|
| `JWT_SECRET`, `ENCRYPTION_KEY`, `JOBS_SECRET` | Set | **Back up `ENCRYPTION_KEY` somewhere safe.** If it is lost, encrypted data is lost too. |
| `PUBLIC_URL` | Set | Change it to the new web address (section 1, step 4). |
| `ADMIN_TWO_STEP=off` | Set, **testing only** | **Delete it before real use**, so admins must use a phone authenticator code. |
| `YOUTUBE_API_KEY` | Not set yet | Google Cloud → YouTube Data API v3. Needed to check YouTube posts. |
| `BREVO_API_KEY`, `MAIL_FROM` | Not set yet | Brevo, for password-reset and alert emails. |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` | Waiting for Meta approval | Set the redirect to `https://<your address>/creator/instagram`. |

Set `DATABASE_URL` on Netlify to an external MySQL 8 service. Netlify Database is PostgreSQL-only and is no longer used by the application.

---

## 4. Before real creators join (go-live checklist)

- [ ] Remove the sample data. Everything named `SAMPLE…` and the sample logins use the password `Sample-Test-2026`. Ask Claude for a clean-up migration, or start a fresh database.
- [ ] Delete `ADMIN_TWO_STEP`, so admin two-step login is on.
- [ ] Set `YOUTUBE_API_KEY` and Brevo email.
- [ ] Have a lawyer finalise the creator terms: the registered company name and the court city are still placeholders. Have a CA confirm the TDS rules on the **Pay rates** page.
- [ ] Add all 32 stores (Campaigns page → Add store), with their map coordinates.
- [ ] Add this year's bank holidays (Pay rates page).
- [ ] Upgrade the Netlify plan and confirm database backups.

---

## 5. Code map and tests

```
backend/            Express API (TypeScript)
  db/schema.sql     canonical database design, converted to MySQL DDL during setup
  db/seed.mysql.sql starting tiers, rates, TDS rules, draft terms
  src/engines/      the rules: budget lock, pay, quality gate, verification, payouts and TDS, visits, jobs
  src/routes/       auth, admin, manager (store visits), influencer
  tests/            automated tests (need a MySQL 8 test database)
frontend/           Next.js static site, all three portals; e2e/journey.cjs is the full browser walk-through
netlify/functions/  api (all /api/* calls) and jobs (daily at 02:00 IST)
netlify/database/migrations/   archived PostgreSQL migrations; not used by the MySQL backend
```

Run the tests with:

```bash
cd backend && DATABASE_URL=mysql://user:password@host:3306/test_database npm test
```
