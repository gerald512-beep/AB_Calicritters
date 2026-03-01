const crypto = require("crypto");

const RUN_ID = process.env.LOAD_TEST_RUN_ID || "lt-run-unknown";
const PHASE = process.env.LOAD_TEST_PHASE || "UNKNOWN";
const SCENARIO = process.env.LOAD_TEST_SCENARIO || "unknown";
const STARTED_AT = process.env.LOAD_TEST_STARTED_AT || new Date().toISOString();

function randomUserId() {
  return `anon_${crypto.randomUUID()}`;
}

function runSessionId() {
  return `lt-${RUN_ID}`;
}

function nowIso() {
  return new Date().toISOString();
}

function attachCommonVars(context) {
  context.vars.lt_run_id = RUN_ID;
  context.vars.lt_phase = PHASE;
  context.vars.lt_scenario = SCENARIO;
  context.vars.lt_started_at = STARTED_AT;
  context.vars.lt_session_id = runSessionId();
}

function setHotkeyAssignmentPayload(context, _events, done) {
  attachCommonVars(context);
  context.vars.assignment_user_id = `anon_hotkey_${RUN_ID}`;
  context.vars.assignment_platform = "ios";
  context.vars.assignment_version = "0.1.0";
  done();
}

function setUniqueAssignmentPayload(context, _events, done) {
  attachCommonVars(context);
  context.vars.assignment_user_id = randomUserId();
  context.vars.assignment_platform = "ios";
  context.vars.assignment_version = "0.1.0";
  done();
}

function setEventsPayload(context, _events, done) {
  attachCommonVars(context);
  context.vars.event_user_id = randomUserId();
  context.vars.event_occurred_at = nowIso();
  done();
}

function setEventsDuplicatePayload(context, _events, done) {
  attachCommonVars(context);
  context.vars.event_user_id = `anon_retry_${RUN_ID}`;
  context.vars.event_occurred_at = nowIso();
  context.vars.event_id = "11111111-1111-4111-8111-111111111111";
  done();
}

function setMixedPayload(context, _events, done) {
  attachCommonVars(context);
  context.vars.assignment_user_id = randomUserId();
  context.vars.assignment_platform = "ios";
  context.vars.assignment_version = "0.1.0";
  context.vars.event_occurred_at = nowIso();
  done();
}

module.exports = {
  setHotkeyAssignmentPayload,
  setUniqueAssignmentPayload,
  setEventsPayload,
  setEventsDuplicatePayload,
  setMixedPayload,
};
