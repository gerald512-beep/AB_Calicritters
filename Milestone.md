# Milestone 1 - Analytics Infrastructure


## 1) Repository and Deployment Snapshot

Codebase status (main branch):

- Monorepo workspaces:
  - `packages/api` (Express + TypeScript API)
  - `packages/jobs` (analytics rollups)
  - `packages/dashboard` (Next.js dashboard)
- Shared DB layer:
  - `prisma/schema.prisma`
  - Prisma migrations in `prisma/migrations/*`

Render status (verified on February 19, 2026):

- API service: `https://ab-calicritters-api.onrender.com` (live)
- Dashboard service: `https://ab-calicritters-dashboard.onrender.com` (live)
- Both deployed from commit `395cc51396d8acebd2dc63f0381d82fa4367e1b6`

## 2) Milestone Requirement Mapping

| Milestone requirement | Implementation in this repo | Status |
|---|---|---|
| Test manifest (`tests.json`) for active A/B tests | Implemented in root `tests.json` and aligned with DB-backed source of truth (`experiments`, `experiment_variants`, `prisma/seed.ts`) | Implemented |
| Stable assignment middleware | Deterministic weighted bucketing + sticky persistence per `anonymous_user_id` in `packages/api/src/services/assignmentService.ts`; endpoint `POST /v1/assignment` in `packages/api/src/index.ts` | Implemented |
| Variant exposure logging middleware | Events are enriched with assignment context (`assignments`, `experiment_map`) in `packages/api/src/services/enrichmentService.ts`, then stored via `eventWriter` in `event_logs` | Implemented (through ingestion pipeline) |
| Desirable action event logger | `POST /v1/events` validates and stores events (e.g., `session_submitted`) in `event_logs` using `packages/api/src/services/eventIngestionService.ts` and `packages/api/src/services/eventWriter.ts` | Implemented |
| Describe challenges in milestone file | Added in Section 6 below | Implemented |

## 3) What Was Implemented (Code Changes)

### 3.1 Assignment Infrastructure

- Test manifest file:
  - `tests.json` (root) lists active experiments, variants, and weights.
- Endpoint: `POST /v1/assignment`
- Request key identifier: `anonymous_user_id` (no account-based `user_id`)
- Validation:
  - required non-empty `anonymous_user_id`
  - optional `platform` constrained to `ios|android`
  - optional `app_version`, `session_id`, `install_id` as strings
- Core logic:
  - Fetch active `RUNNING` experiments
  - Apply `start_at` / `end_at` window logic
  - Apply targeting logic (`platform`, `min_app_version`, `max_app_version`)
  - Reuse existing row in `assignments` for sticky behavior
  - If absent, deterministically assign variant by hash + weights
  - Persist assignment in Postgres
  - Merge baseline config + variant overrides in stable experiment order

Key files:

- `packages/api/src/index.ts`
- `packages/api/src/services/assignmentService.ts`
- `packages/api/src/utils/weightedBucket.ts`
- `packages/api/src/utils/hash.ts`
- `packages/api/src/utils/targeting.ts`
- `packages/api/src/utils/deepMerge.ts`

### 3.2 Event Ingestion and Logging

- Endpoint: `POST /v1/events`
- Supports event batches with partial acceptance (accepted/rejected per event)
- Validation includes:
  - non-empty `events` array
  - `event_name` safe pattern and max length
  - parseable `occurred_at`
  - future skew guard (+5 minutes)
  - JSON object checks for `properties` and `context`
- Enrichment:
  - Attach assignment metadata to each accepted event
  - Include `assignment_version`, assignment list, and `experiment_map`
- Storage:
  - Append-only write to `event_logs`
  - dedup support through unique `event_id` when present

Key files:

- `packages/api/src/services/eventValidation.ts`
- `packages/api/src/services/eventIngestionService.ts`
- `packages/api/src/services/enrichmentService.ts`
- `packages/api/src/services/eventWriter.ts`

### 3.3 Metrics and Dashboard Support (Extended Beyond Milestone Core)

Although Milestone 1 centers on A/B infrastructure, the repo also includes:

- Rollup jobs for analytics (`packages/jobs`)
- Aggregated metric tables:
  - `daily_metric_rollups`
  - `experiment_metric_rollups`
  - `funnel_rollups`
  - `rollup_runs`
- Dashboard metrics APIs:
  - `GET /v1/metrics/summary` (public)
  - `GET /v1/metrics/daily` (token protected)
  - `GET /v1/metrics/experiments` (token protected)
  - `GET /v1/metrics/funnels` (token protected)
- Dashboard UI pages:
  - `/overview`
  - `/experiments`
  - `/ingestion`

## 4) Data Structures Backing Milestone 1

### 4.1 Core A/B Data Tables

- `experiments`
  - metadata for each test (`status`, schedule window, targeting JSON)
- `experiment_variants`
  - variants and weights for each experiment
- `assignments`
  - sticky user-to-variant mapping keyed by `(anonymous_user_id, experiment_id)`
- `event_logs`
  - raw events, with assignment context embedded per row

Schema source:

- `prisma/schema.prisma`

### 4.2 Seeded Active Experiments

From `tests.json` and `prisma/seed.ts`:

1. `exp_3_landing_journey`
   - A: `workouts_preloaded` (weight 0.34)
   - B: `workouts_starter` (weight 0.33)
   - C: `creatures_recommended` (weight 0.33)
2. `exp_4_achievements_density`
   - A: `baseline` (weight 0.5)
   - B: `minimal_achievements` (weight 0.5)

## 5) API Contracts Used for Milestone 1

### 5.1 Assignment API

- `POST /v1/assignment`
- Request (example):

```json
{
  "anonymous_user_id": "550e8400-e29b-41d4-a716-446655440000",
  "platform": "ios",
  "app_version": "0.1.0",
  "session_id": "s_123",
  "install_id": "i_123"
}
```

- Response includes:
  - sticky assignments array
  - merged `config` for client behavior
  - `assignment_version` and `generated_at`

Reference: `docs/AB_ASSIGNMENT_API.md`

### 5.2 Event Ingestion API

- `POST /v1/events`
- Request includes top-level client context plus `events[]`
- Response returns per-event accepted/rejected results

Reference: `docs/EVENT_INGESTION_API.md`

## 6) Challenges Encountered and Resolutions

1. User identity model mismatch  
   Milestone examples assume `user_id`, but the app has no accounts.
   - Resolution: standardized on `anonymous_user_id` generated by client and persisted app-side.

2. Free-tier deployment and migrations  
   Running DB migrations reliably on deployment required explicit setup.
   - Resolution: configured API `preDeployCommand` to run `npm run prisma:migrate:deploy`.

3. Deployment token permissions for workflow files  
   Pushing workflow updates failed when token lacked `workflow` scope.
   - Resolution: deploy code without workflow changes first; schedule automation can be enabled once PAT scope is updated.

4. Privacy in logging  
   Need observability without leaking full identifiers.
   - Resolution: request logs mask/truncate `anonymous_user_id`.

