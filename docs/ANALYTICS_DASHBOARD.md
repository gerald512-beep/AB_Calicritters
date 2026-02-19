# Analytics Jobs and Dashboard

## Overview

Analytics pipeline now runs as scheduled/offline jobs and writes aggregated tables:

1. `daily_metric_rollups`
2. `experiment_metric_rollups`
3. `funnel_rollups`
4. `rollup_runs`

Dashboard endpoints read only these aggregated tables.

## Jobs CLI

- Run all jobs:
  - `npm run jobs:rollup -- --window-days 14`
- Run one job:
  - `npm run jobs:rollup -- --job daily --window-days 14`
  - `npm run jobs:rollup -- --job experiment --window-days 14`
  - `npm run jobs:rollup -- --job funnel --window-days 14`

## Job Definitions

### Daily rollup

Writes per-day metrics:

- `dau`
- `new_users`
- `sessions_submitted`
- `logging_rate_24h`
- `ingestion_lag_p50`
- `ingestion_lag_p95`
- `event_volume_by_name` (dimension key = event name)

### Experiment rollup

Per day + experiment + variant:

- `users_assigned`
- `users_active_d1`
- `sessions_submitted_d7`
- `logging_rate_24h_by_variant`

### Funnel rollup

Funnel name: `core_journey`

Steps:

- `active_open`: `app_opened`, `tab_opened`
- `workout_engaged`: `workouts_default_loaded`, `workout_started`
- `exercise_logged`
- `session_submitted`
- `achievement_unlocked`

Rows are stored overall and per `(experiment_id, variant_id)`.

## Data Quality Rules

Events are ignored when:

- `occurred_at` is more than 5 minutes in the future
- `occurred_at` is older than 180 days

Ignored counts are recorded in `rollup_runs.ignored_count`.

## Idempotency

- Daily metrics: upsert by `(day, metric_name, dimension_key)`
- Experiment metrics: upsert by `(day, experiment_id, variant_id, metric_name)`
- Funnel metrics: delete+recreate per `(day, funnel_name, step_name)` window
- Each run tracked in `rollup_runs`

## Dashboard Endpoints

Protected with header:

- `x-dashboard-token: <DASHBOARD_TOKEN>`

Endpoints:

- `GET /v1/metrics/daily?window_days=7`
- `GET /v1/metrics/experiments?window_days=7&experiment_id=...`
- `GET /v1/metrics/funnels?window_days=7&funnel_name=core_journey`

Unprotected summary endpoint:

- `GET /v1/metrics/summary?window_days=7`

## Scheduling

GitHub Actions cron:

- `.github/workflows/analytics-rollup.yml`

Required secret:

- `DATABASE_URL`
