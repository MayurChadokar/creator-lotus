# Influencer Platform: Backend (Stage 1)

| File | What it is |
|---|---|
| `db/schema.sql` | Every database table, plus the safety rules enforced by the database |
| `db/seed.sql` | Starting tiers, rate cards, multipliers, TDS rule and draft Terms |
| `src/engines/budget.ts` | Engine 1: budget and quota tracking, auto-locking, campaign lifecycle |
| `src/engines/pricing.ts` | Engine 2: pay, TDS and net payout arithmetic |
| `src/engines/qualityGate.ts` | Engine 3: engagement rules, bot warning signs, link reading |
| `src/engines/verification.ts` | Engine 3: submissions, live checks, zero-pay enforcement |
| `src/engines/liability.ts` | Engine 4: demo units, disputes, overrides |
| `src/engines/payouts.ts` | Payment sheets, 3-working-day dates, RazorpayX release, CSV |
| `src/engines/jobs.ts` | Scheduled work: checks, expiry, tiers, daily sheet |
| `src/integrations/*` | Connectors to Instagram, YouTube and RazorpayX |
| `src/routes/*` | The web addresses the three portals will call (Stage 2) |
| `tests/*` | Automated tests |

Commands: `npm install`, `npm run db:setup`, `npm run dev`, `npm test`. Settings are listed in `.env.example`.
Stage 3 will walk through going live step by step.
