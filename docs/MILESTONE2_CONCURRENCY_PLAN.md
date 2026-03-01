# Milestone 2 Concurrency Plan

## Objective

Implement and report a reproducible concurrency testing workflow for the backend API
(`POST /v1/assignment`, `POST /v1/events`) that satisfies the Milestone 2 PDF:

- stress test under concurrent load
- evaluate error rates, data consistency, and performance
- identify async opportunities
- apply mitigations
- re-run same tests and quantify impact

## Scope

### Endpoints under test

1. `POST /v1/assignment` (write/mutates shared `assignments`)
2. `POST /v1/events` (write/mutates shared `event_logs`)
3. Optional context read: `GET /v1/metrics/summary`

### Environments

- Primary benchmark environment for this milestone: local laptop + local API process.
- Target URL should be stable and low-variance (for local runs: `http://localhost:3000`).

## Prerequisites

1. Dependencies installed:
   - `npm install`
2. Database configured and migrated:
   - `.env` includes `DATABASE_URL` and `DASHBOARD_TOKEN`
   - `npm run prisma:migrate:dev` (local) or `npm run prisma:migrate:deploy`
   - `npm run prisma:seed`
3. API running:
   - `npm run dev`
4. Dashboard running (optional while collecting):
   - `npm run dashboard:dev`

## Data Model for Baseline and Re-Tests

Load test results are persisted in:

1. `load_test_runs`
   - run metadata: name, scenario, phase, target, `started_at`, `ended_at`, `duration_ms`, tags
2. `load_test_endpoint_metrics`
   - per endpoint/method latency and throughput metrics
3. `load_test_data_checks`
   - pass/fail consistency checks with observed values

Raw Artillery artifacts are stored in:

- `artifacts/load-tests/*.json`
- `artifacts/load-tests/*.html`

Why: DB-backed results make dashboard comparison stable and repeatable; artifact files provide audit trace.

## Test Scenarios

Artillery scenarios:

1. `assignment`:
   - mixed hot-key and unique-user assignment traffic
2. `events`:
   - normal event batches + duplicate `event_id` retry stream
3. `mixed`:
   - assignment then event ingestion in one flow

Why: these scenarios cover high-contention writes, dedup behavior, and mixed endpoint interaction.

## Execution Procedure

### Step 1: Baseline runs (before additional mitigations)

Run each scenario in baseline phase:

1. `npm run loadtest:run -- --scenario assignment --phase baseline --target http://localhost:3000 --run-name baseline_assignment_v1 --tag env=laptop --tag cohort=baseline`
2. `npm run loadtest:run -- --scenario events --phase baseline --target http://localhost:3000 --run-name baseline_events_v1 --tag env=laptop --tag cohort=baseline`
3. `npm run loadtest:run -- --scenario mixed --phase baseline --target http://localhost:3000 --run-name baseline_mixed_v1 --tag env=laptop --tag cohort=baseline`

Repeat each run at least 3 times with the same scenario settings.

Why: repeated baselines reduce noise and produce defensible comparisons.

### Step 2: Implement and confirm mitigations

Required mitigation categories:

1. Write-path idempotency for ingestion retries
2. Assignment write contention reduction
3. Async refactor in critical path where safe
4. Rollup overlap control during load test windows

Why: Milestone 2 expects concrete mitigations and measured impact.

### Step 3: Post-mitigation runs

Use the same scenarios and target, switching phase:

1. `npm run loadtest:run -- --scenario assignment --phase post_mitigation --target http://localhost:3000 --run-name post_assignment_v1 --tag env=laptop --tag cohort=post`
2. `npm run loadtest:run -- --scenario events --phase post_mitigation --target http://localhost:3000 --run-name post_events_v1 --tag env=laptop --tag cohort=post`
3. `npm run loadtest:run -- --scenario mixed --phase post_mitigation --target http://localhost:3000 --run-name post_mixed_v1 --tag env=laptop --tag cohort=post`

Why: strict baseline/post symmetry is required for meaningful deltas.

## Start, End, and Run Tagging Controls

Every run persists:

- `started_at`
- `ended_at`
- `duration_ms`
- phase (`BASELINE`, `POST_MITIGATION`)
- scenario
- custom tags (`--tag key=value`)

Recommended tags:

1. `env=laptop`
2. `cohort=baseline|post`
3. `operator=<name>`
4. `task=milestone2`

Why: traceability and reproducibility across multiple iterations/operators.

## Checkpoints and Quality Gates

Each run writes checks to `load_test_data_checks`:

1. `assignment_duplicate_rows_global` must be `0`
2. `event_id_duplicate_rows_global` must be `0`
3. `sticky_assignment_conflicts_scoped` must be `0`
4. `load_test_assignment_rows_scoped` is scenario-aware:
   - `assignment` and `mixed`: must be `> 0`
   - `events`: must be `0`
5. `load_test_event_rows_scoped` is scenario-aware:
   - `events` and `mixed`: must be `> 0`
   - `assignment`: must be `0`
6. `rollup_overlap_running` must be `0`
7. `http_error_rate_under_1pct` target `<= 1%`

Why: turns qualitative correctness into enforceable pass/fail gates.

Automated control command:

- `npm run loadtest:assert -- --scenario assignment --phase baseline --max-error-rate 0.01`
- `npm run loadtest:assert -- --scenario events --phase post_mitigation --max-error-rate 0.01`

## Dashboard Procedure

Use dashboard tab `/benchmarks` to review:

1. Latest baseline and post-mitigation run pair
2. Endpoint deltas:
   - `delta_p95_ms`
   - `delta_p99_ms`
   - `delta_error_rate`
   - `delta_rps`
3. Data consistency check deltas
4. Recent run history

Why: centralized visualization shortens feedback loop and makes milestone reporting easier.

## Success Criteria

Milestone is considered complete when:

1. Baseline and post-mitigation runs exist for assignment/events/mixed scenarios.
2. Dashboard shows those runs and computed deltas.
3. Consistency checks pass (no duplicate or corrupt state indicators).
4. Error rate and latency/throughput changes are quantified with before/after evidence.
5. Milestone write-up includes:
   - methodology
   - metrics tables
   - issues found
   - mitigation impact
   - planned next mitigations

## Why This Sequence

1. Measure first, then optimize: avoids unverified improvements.
2. Persist everything in DB: ensures reproducibility and team visibility.
3. Enforce gates with checks: catches silent data corruption under concurrency.
4. Keep workload definitions fixed between phases: isolates mitigation effects.
