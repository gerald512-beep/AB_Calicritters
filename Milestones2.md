# Milestones

## Milestone 1 - Analytics Infrastructure

Detailed implementation and deployment summary is documented in:

- `Milestone.md`

## Milestone 2 - Concurrency

### Objective (PDF alignment)

Stress test concurrent backend load on write endpoints, detect concurrency/data-integrity issues,
apply mitigation techniques, and quantify baseline vs post-mitigation impact with explicit evidence.

### Scope and endpoints under test

1. `POST /v1/assignment`
2. `POST /v1/events`
3. Combined mixed flow (`assignment` then `events`)

### Implemented concurrency techniques

1. Sticky assignment race mitigation:
   - DB uniqueness: `(anonymous_user_id, experiment_id)` in `assignments`
   - `upsert` with `update: {}` to keep first persisted assignment sticky
2. Event ingestion idempotency:
   - deterministic fallback `event_id` generation
   - `createMany(..., skipDuplicates: true)` for event writes
   - unique `event_id` constraint
3. Rollup overlap control:
   - Postgres advisory lock (`pg_try_advisory_lock` / `pg_advisory_unlock`)
4. Idempotent rollups:
   - unique keys + `upsert` in daily/experiment rollups
   - transactional delete+create for funnel/day dimensions
5. Concurrency quality gates:
   - duplicate detection checks
   - sticky conflict check
   - rollup overlap check
   - error-rate threshold check

### Implemented artifacts

1. Load test scenarios:
   - `packages/jobs/loadtests/scenarios/assignment.json`
   - `packages/jobs/loadtests/scenarios/events.json`
   - `packages/jobs/loadtests/scenarios/mixed.json`
2. Load test runner and assertions:
   - `packages/jobs/src/loadtest/runLoadTest.ts`
   - `packages/jobs/src/loadtest/assertLoadTest.ts`
3. DB-backed benchmark storage:
   - `load_test_runs`
   - `load_test_endpoint_metrics`
   - `load_test_data_checks`
4. Dashboard evidence page:
   - `/benchmarks` (explicit scenario-level baseline vs post evidence)
5. Plan and procedure:
- `docs/MILESTONE2_CONCURRENCY_PLAN.md`

### Test execution (local evidence)

Execution date: March 1, 2026 (local benchmark cycle).

#### Baseline runs used

1. Assignment:
   - Run ID: `cmm03c8ny0000oc6k8syvazxe`
   - Run name: `local_baseline_assignment_v2`
2. Events:
   - Run ID: `cmm03euqd0000ocx478zqz60p`
   - Run name: `local_baseline_events`
3. Mixed:
   - Run ID: `cmm7cvjc70000ochkpkn2lvwm`
   - Run name: `baseline_mixed_v1`

#### Post-mitigation runs used

1. Assignment:
   - Run ID: `cmm7cxzqt0000ocuciufair0a`
   - Run name: `post_assignment_v1`
2. Events:
   - Run ID: `cmm7d06vv0000ocgga4lszc4c`
   - Run name: `post_events_v1`
3. Mixed:
   - Run ID: `cmm7d2ach0000occom80i4ezo`
   - Run name: `post_mixed_v1`

### Validation checkpoints

Per run checks are persisted in `load_test_data_checks` and shown in `/benchmarks`.
Required pass criteria:

1. No duplicate assignment rows.
2. No duplicate event IDs.
3. No scoped sticky-assignment conflicts.
4. Scoped load-test rows are scenario-aware:
   - assignment and mixed runs require assignment rows.
   - events and mixed runs require event rows.
5. Rollup overlap check passes.
6. Error-rate threshold check passes (`<= 1%` target).

Control command:

- `npm run loadtest:assert -- --scenario assignment --phase baseline --max-error-rate 0.01`

Result:

- All required baseline and post-mitigation scenario assertions passed (`ok: true`, no failures).

### Quantified baseline vs post results

| Scenario | Baseline Error Rate | Post Error Rate | Delta Error Rate | Baseline p95 (ms) | Post p95 (ms) | Delta p95 (ms) | Baseline RPS | Post RPS | Delta RPS | Baseline Checks | Post Checks |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| assignment | 0.155% | 0.000% | -0.155% | 354.3 | 347.3 | -7.0 | 7.34 | 6.94 | -0.41 | 7/7 | 7/7 |
| events | 0.000% | 0.000% | 0.000% | 179.5 | 156.0 | -23.5 | 5.73 | 5.88 | +0.15 | 7/7 | 7/7 |
| mixed | 0.000% | 0.000% | 0.000% | 294.9 | 301.5 | +6.6 | 7.89 | 8.98 | +1.09 | 7/7 | 7/7 |

### Findings

1. Assignment path:
   - Error rate improved to zero.
   - p95 improved.
   - Throughput decreased slightly.
2. Events path:
   - Maintained zero error rate.
   - p95 improved materially.
   - Throughput improved slightly.
3. Mixed path:
   - Maintained zero error rate.
   - Throughput improved.
   - p95 regressed slightly, likely from mixed-path interaction and scheduling variance.

### Evidence locations

1. Dashboard:
   - `/benchmarks` now shows explicit scenario-by-scenario baseline vs post evidence.
2. DB tables:
   - `load_test_runs`
   - `load_test_endpoint_metrics`
   - `load_test_data_checks`
3. Artillery artifacts:
   - `artifacts/load-tests/*.json`
   - `artifacts/load-tests/*.html`

### Repro commands

1. Run baseline:
   - `npm run loadtest:run -- --scenario assignment --phase baseline --target http://localhost:3000 --run-name baseline_assignment_v1 --tag env=laptop --tag cohort=baseline`
   - `npm run loadtest:run -- --scenario events --phase baseline --target http://localhost:3000 --run-name baseline_events_v1 --tag env=laptop --tag cohort=baseline`
   - `npm run loadtest:run -- --scenario mixed --phase baseline --target http://localhost:3000 --run-name baseline_mixed_v1 --tag env=laptop --tag cohort=baseline`
2. Run post:
   - `npm run loadtest:run -- --scenario assignment --phase post_mitigation --target http://localhost:3000 --run-name post_assignment_v1 --tag env=laptop --tag cohort=post`
   - `npm run loadtest:run -- --scenario events --phase post_mitigation --target http://localhost:3000 --run-name post_events_v1 --tag env=laptop --tag cohort=post`
   - `npm run loadtest:run -- --scenario mixed --phase post_mitigation --target http://localhost:3000 --run-name post_mixed_v1 --tag env=laptop --tag cohort=post`
3. Enforce gates:
   - `npm run loadtest:assert -- --scenario assignment --phase baseline --max-error-rate 0.01`
   - `npm run loadtest:assert -- --scenario events --phase baseline --max-error-rate 0.01`
   - `npm run loadtest:assert -- --scenario mixed --phase baseline --max-error-rate 0.01`
   - `npm run loadtest:assert -- --scenario assignment --phase post_mitigation --max-error-rate 0.01`
   - `npm run loadtest:assert -- --scenario events --phase post_mitigation --max-error-rate 0.01`
   - `npm run loadtest:assert -- --scenario mixed --phase post_mitigation --max-error-rate 0.01`
