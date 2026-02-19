# Event Ingestion API

## Endpoint

- `POST /v1/events`
- `Content-Type: application/json`

## Request Body

```json
{
  "anonymous_user_id": "string required non-empty",
  "session_id": "string optional",
  "install_id": "string optional",
  "platform": "ios|android optional",
  "app_version": "string optional",
  "sent_at": "ISO datetime optional",
  "events": [
    {
      "event_id": "uuid optional",
      "event_name": "string required",
      "occurred_at": "ISO datetime required",
      "properties": { "any": "json object" },
      "context": { "any": "json object" }
    }
  ]
}
```

## Validation Rules

- `anonymous_user_id` required and non-empty
- `events` must be a non-empty array
- per event:
  - `event_name` required, max 80 chars, pattern `^[A-Za-z0-9_]+$`
  - `occurred_at` required, parseable ISO datetime
  - `occurred_at` cannot be more than 5 minutes in the future
  - `properties` and `context` must be JSON objects if provided
  - `event_id` must be UUID if provided

## Partial Batch Handling

- Batch request returns `200` with per-event statuses.
- Malformed top-level payload returns `400`.
- Invalid events inside a valid batch are rejected individually.
- Valid events in same batch are accepted and written.

## Response

```json
{
  "ok": true,
  "received_at": "2026-02-19T00:00:00.000Z",
  "accepted": 2,
  "rejected": 1,
  "results": [
    { "index": 0, "status": "accepted", "event_id": "..." },
    { "index": 1, "status": "accepted", "event_id": "..." },
    { "index": 2, "status": "rejected", "error": "event_name has invalid characters" }
  ]
}
```

## Enrichment

Accepted events are enriched once per batch with current assignment context for the `anonymous_user_id`:

- `assignment_version`
- `assignments`: array of `{ experiment_id, variant_id, variant_name }`
- `experiment_map`: `{ [experiment_id]: variant_id }`

Important:
- Enrichment reads existing assignments only.
- Ingestion does **not** auto-create assignments.

## Storage and Dedup

Events are stored append-only in `event_logs`.

- `event_id` has a unique constraint when present.
- Server generates `event_id` if missing.
- Writes use batch insert (`createMany`) with duplicate skipping.

## DB Unavailable Behavior

If DB connectivity is unavailable:
- returns `503 Service Unavailable`
- payload:
```json
{
  "error": "Service Unavailable",
  "message": "Database is temporarily unavailable. Please retry."
}
```

## Metrics Endpoints

Metrics are read from aggregated rollup tables populated by jobs (`npm run jobs:rollup`).

Public summary endpoint:

- `GET /v1/metrics/summary?window_days=7`

Dashboard-protected endpoints (header `x-dashboard-token` required):

- `GET /v1/metrics/daily?window_days=7`
- `GET /v1/metrics/experiments?window_days=7&experiment_id=...`
- `GET /v1/metrics/funnels?window_days=7&funnel_name=core_journey`

`window_days` must be an integer in `1..90`.

## Event Name Examples

- `onboarding_started`
- `onboarding_strength_selected`
- `onboarding_skipped`
- `onboarding_completed`
- `tab_opened`
- `workouts_default_loaded`
- `workout_custom_created`
- `workout_saved`
- `workout_started`
- `exercise_logged`
- `workout_completed`
- `logging_opened`
- `log_entry_started`
- `log_entry_committed`
- `session_submitted`
- `skilltree_opened`
- `node_opened`
- `node_completed`
- `achievement_unlocked`
- `app_opened`
