# Influencer Platform: Screens (Stage 2)

| Folder | What it is |
|---|---|
| `src/app/page.tsx`, `login`, `register` | Public page, log-in and creator sign-up |
| `src/app/admin/*` | Master Admin: campaigns, payments and tax, creators, payment matrix, reviews and disputes, audit log |
| `src/app/manager/*` | Store Manager: video reviews, local briefs, creators, demo units, disputes |
| `src/app/creator/*` | Influencer Portal: earnings tracker, campaigns, calculator, demo units, help, profile |
| `src/components/*` | Shared buttons, tables, dialogs and desks |
| `tailwind.config.ts` | Brand colours: change these to re-skin everything |
| `e2e/journey.cjs` | The automated click-through test |

Settings are listed in `.env.example`, including the name shown on screen.
