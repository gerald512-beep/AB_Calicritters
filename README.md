# AB Calicritters Backend

Node.js + TypeScript + Express service for:
- A/B assignment (`/v1/assignment`)
- Event ingestion (`/v1/events`)
- On-demand metrics rollups (`/v1/metrics/summary`)

It uses Postgres + Prisma, keeps assignment sticky per anonymous user, enriches events with existing assignments, and stores rollups in DB.

## Endpoints

- `GET /health` -> `{ "ok": true }`
- `POST /v1/assignment` -> sticky assignments + merged config
- `POST /v1/events` -> batch ingest with per-event accept/reject results
- `GET /v1/metrics/summary` -> computes + stores latest summary rollups

See docs:
- `docs/AB_ASSIGNMENT_API.md`
- `docs/EVENT_INGESTION_API.md`

## Local Setup

1. Install dependencies:
   - `npm install`
2. Create `.env` in project root:
   - `DATABASE_URL="postgresql://..."`
3. Generate Prisma client:
   - `npm run prisma:generate`
4. Create/update schema locally:
   - `npm run prisma:migrate:dev`
5. Seed baseline experiments and variants:
   - `npm run prisma:seed`
6. Start server:
   - `npm run dev`

## Production

1. Set `DATABASE_URL` in Render service environment variables.
2. Apply migrations:
   - `npm run prisma:migrate:deploy`
3. Seed only if DB is empty or when intentionally updating managed experiment fixtures:
   - `npm run prisma:seed`

Seeding approach:
- Seed uses upserts for known experiments/variants and is idempotent for those records.
- It can update seeded experiment definitions if they differ from DB values.

## Useful Scripts

- `npm run build`
- `npm run start`
- `npm run prisma:generate`
- `npm run prisma:migrate:dev`
- `npm run prisma:migrate:deploy`
- `npm run prisma:seed`
- `npm run check:determinism`
- `npm run metrics:rollup`
