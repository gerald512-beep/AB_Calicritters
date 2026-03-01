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
- `GET /v1/metrics/load-tests/runs?limit=20`
- `GET /v1/metrics/load-tests/latest`
- `GET /v1/metrics/load-tests/compare?baseline_run_id=...&candidate_run_id=...`

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

## Milestone 2 Concurrency Load Testing

The repo includes Artillery scenarios and a run pipeline that stores baseline and post-mitigation
results in Postgres for dashboard visualization.

### What is measured

- Error rate (`5xx`, timeouts, transport errors)
- Throughput (RPS)
- Latency (`p50`, `p95`, `p99`)
- Data consistency checks:
  - duplicate assignment rows
  - duplicate event IDs
  - scoped sticky-assignment conflicts
  - scoped row presence for assignment/event load-test tags
  - rollup overlap control

### Data storage

Load-test outputs are persisted to:

- `load_test_runs`
- `load_test_endpoint_metrics`
- `load_test_data_checks`

Raw Artillery artifacts are written to:

- `artifacts/load-tests/*.json`
- `artifacts/load-tests/*.html`

### Artillery scenarios

- `packages/jobs/loadtests/scenarios/assignment.json`
- `packages/jobs/loadtests/scenarios/events.json`
- `packages/jobs/loadtests/scenarios/mixed.json`

### Run baseline locally

1. Start API locally:
   - `npm run dev`
2. Run baseline scenarios (separate terminal):
   - `npm run loadtest:baseline:assignment`
   - `npm run loadtest:baseline:events`
   - `npm run loadtest:baseline:mixed`

Or run with explicit tags and metadata:

- `npm run loadtest:run -- --scenario assignment --phase baseline --target http://localhost:3000 --run-name baseline_assignment_v1 --tag env=laptop --tag cohort=baseline`
- `npm run loadtest:run -- --scenario events --phase baseline --target http://localhost:3000 --run-name baseline_events_v1 --tag env=laptop --tag cohort=baseline`

Enforce gates immediately after each run:

- `npm run loadtest:assert -- --scenario assignment --phase baseline --max-error-rate 0.01`
- `npm run loadtest:assert -- --scenario events --phase baseline --max-error-rate 0.01`

### Run post-mitigation tests

- `npm run loadtest:run -- --scenario assignment --phase post_mitigation --target http://localhost:3000 --run-name post_assignment_v1 --tag env=laptop --tag cohort=post`
- `npm run loadtest:run -- --scenario events --phase post_mitigation --target http://localhost:3000 --run-name post_events_v1 --tag env=laptop --tag cohort=post`
- `npm run loadtest:run -- --scenario mixed --phase post_mitigation --target http://localhost:3000 --run-name post_mixed_v1 --tag env=laptop --tag cohort=post`

### Start/end and run tags

Each run records:

- `started_at`
- `ended_at`
- `duration_ms`
- `phase` (`BASELINE` or `POST_MITIGATION`)
- `scenario_name`
- custom key/value tags via repeated `--tag key=value`

### Automated control gates

Use the assertion command to enforce milestone pass/fail controls:

- `npm run loadtest:assert -- --run-id <load_test_run_id>`
- `npm run loadtest:assert -- --scenario mixed --phase post_mitigation --max-error-rate 0.01`

### Dashboard

Open dashboard tab:

- `/benchmarks`

It displays:

- latest baseline and post-mitigation runs
- endpoint metric deltas
- data consistency check deltas
- recent run history

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
