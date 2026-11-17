# Creator Lotus

Creator campaign management platform for Lotus Electronics Supermarket, with separate portals for administrators, store managers, and creators.

## Local development

1. Copy `backend/.env.example` to `backend/.env` and configure the MySQL connection and application secrets.
2. Copy `frontend/.env.example` to `frontend/.env.local`.
3. Install dependencies in both `backend` and `frontend`.
4. Start the backend with `npm run dev` from `backend/`.
5. Start the frontend with `npm run dev` from `frontend/`.

The frontend runs at `http://localhost:3000` and the backend at `http://localhost:4000` by default.

## Deployment

The repository includes `netlify.toml` for deploying the static Next.js frontend and Netlify Functions. A MySQL 8 database and the environment variables documented in `backend/.env.example` are required.

See `HANDOVER.md` for the production checklist and operational notes.
