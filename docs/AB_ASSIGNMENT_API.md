# A/B Assignment API

## Endpoint

- `POST /v1/assignment`
- `Content-Type: application/json`

## Request Body

```json
{
  "anonymous_user_id": "string required",
  "session_id": "string optional",
  "platform": "ios|android optional",
  "app_version": "string optional",
  "install_id": "string optional"
}
```

## Validation

- `anonymous_user_id` is required and must be a non-empty string.
- `platform` must be `ios` or `android` when provided.
- `session_id`, `app_version`, and `install_id` must be strings when provided.
- Invalid input returns `400`.

## Success Response

```json
{
  "anonymous_user_id": "550e8400-e29b-41d4-a716-446655440000",
  "assignment_version": 1,
  "generated_at": "2026-02-18T00:00:00.000Z",
  "assignments": [
    {
      "experiment_id": "exp_3_landing_journey",
      "variant_id": "A",
      "variant_name": "workouts_preloaded"
    },
    {
      "experiment_id": "exp_4_achievements_density",
      "variant_id": "B",
      "variant_name": "minimal_achievements"
    }
  ],
  "config": {
    "navigation": {
      "default_landing_tab": "workouts"
    },
    "workouts": {
      "preload_default_plan": true
    },
    "creatures": {
      "recommended_creature_id": null
    },
    "achievements": {
      "ui_mode": "minimal"
    }
  }
}
```

## Assignment Rules

- Experiments are fetched dynamically from Postgres.
- Eligible experiments must be:
  - `status = RUNNING`
  - inside `start_at` / `end_at` window when those values are set
  - matching targeting rules if provided
- Targeting keys currently supported:
  - `platform`
  - `min_app_version`
  - `max_app_version`

## Sticky Assignment

- Assignments are stored in DB with unique key:
  - `(anonymous_user_id, experiment_id)`
- Existing assignment is always reused (sticky behavior).
- New assignments use deterministic weighted bucketing:
  - hash of `anonymous_user_id + experiment_id` -> float in `[0,1)`
  - variant selected by cumulative weights

## Config Merge Order

1. Baseline config
2. Variant overrides in stable order by `experiment_id`

The API does not return allocation weights or exposure metadata.

## Error Handling

- `503 Service Unavailable` if database is unreachable.
- `500 Internal Server Error` for unexpected failures.
