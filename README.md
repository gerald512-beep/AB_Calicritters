# AB Calicritters Assignment API

Node.js + TypeScript + Express service for A/B variant assignment with Postgres + Prisma.

## Endpoints

- `GET /health` -> `{ "ok": true }`
- `POST /v1/assignment` -> sticky assignments + merged config

## Local Setup

1. Install dependencies:
   - `npm install`
2. Create `.env` in project root:
   - `DATABASE_URL="postgresql://..."`
3. Create/update schema locally:
   - `npx prisma migrate dev`
4. Seed baseline experiments and variants:
   - `npx prisma db seed`
5. Start server:
   - `npm run dev`

## Production

1. Set `DATABASE_URL` in Render service environment variables.
2. Apply migrations:
   - `npx prisma migrate deploy`
3. Seed only if DB is empty:
   - `npx prisma db seed`

Seeding approach:
- Current seed uses upserts for known experiments/variants and is idempotent for those records.
- Run in production only when you intend to create/update the managed experiment set.

## Useful Scripts

- `npm run build`
- `npm run start`
- `npm run prisma:generate`
- `npm run prisma:migrate:dev`
- `npm run prisma:migrate:deploy`
- `npm run prisma:seed`
- `npm run check:determinism`
