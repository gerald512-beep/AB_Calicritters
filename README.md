# AB Calicritters Monorepo

Node.js + TypeScript monorepo for A/B assignments, event ingestion, analytics jobs, and dashboard UI.

## Packages

- `packages/api`: Express API (`/health`, `/v1/assignment`, `/v1/events`, metrics endpoints)
- `packages/jobs`: Analytics rollup worker/CLI
- `packages/dashboard`: Next.js dashboard UI
- `prisma`: Shared Prisma schema + migrations + seed

## Architecture

1. Mobile app requests sticky assignments from `POST /v1/assignment`
2. Mobile app sends event batches to `POST /v1/events`
3. Events are enriched with assignment context and stored in `event_logs`
4. Jobs package computes idempotent rollups into aggregated tables
5. Dashboard reads only aggregated metrics endpoints

## Environment Variables

Use `.env.example` as a template.

Required for API/jobs:

- `DATABASE_URL`: Postgres connection string
- `DASHBOARD_TOKEN`: token required by dashboard metrics endpoints

Required for dashboard runtime:

- `API_BASE_URL`: base URL for API service (for example `https://ab-calicritters-api.onrender.com`)
- `DASHBOARD_TOKEN`: same token configured in API

## Install and Run Locally

1. Install dependencies:
   - `npm install`
2. Configure environment:
   - copy `.env.example` to `.env`
   - set `DATABASE_URL` and `DASHBOARD_TOKEN`
3. Generate Prisma client:
   - `npm run prisma:generate`
4. Apply local migrations:
   - `npm run prisma:migrate:dev`
5. Seed base experiments:
   - `npm run prisma:seed`

Run services:

- API dev server:
  - `npm run dev`
- Dashboard dev server:
  - `npm run dashboard:dev`
- One-off analytics rollups:
  - `npm run jobs:rollup -- --window-days 14`

## Build Commands

- Build all workspaces:
  - `npm run build`
- Build only API:
  - `npm run build -w @ab-calicritters/api`
- Build only jobs:
  - `npm run build -w @ab-calicritters/jobs`
- Build only dashboard:
  - `npm run build -w @ab-calicritters/dashboard`

## API Endpoints

Public endpoints:

- `GET /health`
- `POST /v1/assignment`
- `POST /v1/events`
- `GET /v1/metrics/summary`

Dashboard endpoints (require `x-dashboard-token`):

- `GET /v1/metrics/daily?window_days=7`
- `GET /v1/metrics/experiments?window_days=7&experiment_id=...`
- `GET /v1/metrics/funnels?window_days=7&funnel_name=core_journey`

See:

- `docs/AB_ASSIGNMENT_API.md`
- `docs/EVENT_INGESTION_API.md`
- `docs/ANALYTICS_DASHBOARD.md`

## Analytics Jobs

CLI:

- `npm run jobs:rollup -- --window-days 14`
- `npm run jobs:rollup -- --job daily --window-days 14`
- `npm run jobs:check:idempotency`

Jobs write into:

- `daily_metric_rollups`
- `experiment_metric_rollups`
- `funnel_rollups`
- `rollup_runs`

Rollups are idempotent via unique constraints + upsert/rewrite logic.

## Scheduling on Free Tier

A GitHub Actions workflow runs daily rollups:

- `.github/workflows/analytics-rollup.yml`

Set repository secret:

- `DATABASE_URL`

The workflow runs:

1. `npm ci`
2. `npm run prisma:generate`
3. `npm run jobs:rollup -- --window-days 14`

## Render Deployment Notes

`render.yaml` is workspace-aware and defines two services:

- API service (`ab-calicritters-api`)
  - build: `npm ci --include=dev && npm run prisma:generate && npm run build -w @ab-calicritters/api`
  - start: `npm run start -w @ab-calicritters/api`
- Dashboard service (`ab-calicritters-dashboard`)
  - build: `npm ci --include=dev && npm run build -w @ab-calicritters/dashboard`
  - start: `npm run start -w @ab-calicritters/dashboard`

Render env vars required for API:

- `DATABASE_URL`
- `DASHBOARD_TOKEN`

Render env vars required for dashboard:

- `API_BASE_URL`
- `DASHBOARD_TOKEN`

Apply production migrations:

- `npm run prisma:migrate:deploy`
