#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/AB_Calicritters}"
API_SERVICE="${API_SERVICE:-ab-calicritters-api.service}"
DASH_SERVICE="${DASH_SERVICE:-ab-calicritters-dashboard.service}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
DASH_BASE_URL="${DASH_BASE_URL:-http://127.0.0.1:3001}"
ASSIGNMENT_TEST_USER="${ASSIGNMENT_TEST_USER:-verify-user-remote-001}"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

check_200() {
  local name="$1"
  local url="$2"
  local body_file
  body_file="$(mktemp)"
  local code
  code="$(curl -sS -o "$body_file" -w "%{http_code}" "$url")"
  if [[ "$code" != "200" ]]; then
    log "ERROR: ${name} failed with HTTP ${code}"
    cat "$body_file"
    rm -f "$body_file"
    exit 1
  fi
  rm -f "$body_file"
  log "OK: ${name} -> HTTP 200"
}

log "Starting Yale deploy + verification"
log "Repo dir: ${REPO_DIR}"

cd "$REPO_DIR"

git fetch origin
git checkout main
git pull --ff-only origin main

log "Installing dependencies"
npm ci

log "Generating Prisma client"
npm run prisma:generate

log "Applying production migrations"
npm run prisma:migrate:deploy

log "Restarting services"
sudo systemctl restart "$API_SERVICE"
sudo systemctl restart "$DASH_SERVICE"

sudo systemctl --no-pager --full status "$API_SERVICE" | sed -n '1,14p'
sudo systemctl --no-pager --full status "$DASH_SERVICE" | sed -n '1,14p'

log "Checking API and dashboard endpoints"
check_200 "health" "${API_BASE_URL}/health"

assignment_payload="$(cat <<JSON
{"anonymous_user_id":"${ASSIGNMENT_TEST_USER}","platform":"ios","app_version":"0.1.0","session_id":"verify-session-remote","install_id":"verify-install-remote"}
JSON
)"

assignment_code="$(curl -sS -o /tmp/assignment_verify.json -w "%{http_code}" -X POST "${API_BASE_URL}/v1/assignment" -H "Content-Type: application/json" -d "$assignment_payload")"
if [[ "$assignment_code" != "200" ]]; then
  log "ERROR: assignment failed with HTTP ${assignment_code}"
  cat /tmp/assignment_verify.json
  exit 1
fi
log "OK: assignment -> HTTP 200"

now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
events_payload="$(cat <<JSON
{"anonymous_user_id":"${ASSIGNMENT_TEST_USER}","session_id":"verify-session-remote","platform":"ios","app_version":"0.1.0","events":[{"event_name":"app_opened","occurred_at":"${now_iso}","properties":{"source":"yale-deploy-verify"}}]}
JSON
)"

events_code="$(curl -sS -o /tmp/events_verify.json -w "%{http_code}" -X POST "${API_BASE_URL}/v1/events" -H "Content-Type: application/json" -d "$events_payload")"
if [[ "$events_code" != "200" ]]; then
  log "ERROR: events failed with HTTP ${events_code}"
  cat /tmp/events_verify.json
  exit 1
fi
log "OK: events -> HTTP 200"

check_200 "dashboard overview" "${DASH_BASE_URL}/overview"
check_200 "dashboard benchmarks" "${DASH_BASE_URL}/benchmarks"

log "Deployment + migration + restart + verification completed successfully"