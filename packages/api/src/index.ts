/**
 * Quick start:
 * curl -X POST "http://localhost:3000/v1/assignment" -H "Content-Type: application/json" -d "{\"anonymous_user_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"platform\":\"ios\",\"app_version\":\"0.1\"}"
 */
import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { getAssignmentPayload } from "./services/assignmentService";
import {
  EventValidationError,
  ingestEventBatch,
} from "./services/eventIngestionService";
import {
  getDailyMetrics,
  getExperimentMetrics,
  getFunnelMetrics,
  getLatestLoadTests,
  getLoadTestComparison,
  getLoadTestRuns,
  getSummaryMetrics,
} from "./services/aggregationService";
import { isDatabaseUnavailableError } from "./utils/dbErrors";

type Platform = "ios" | "android";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`,
    );
  });
  next();
});

function validatePlatform(value: unknown): value is Platform {
  return value === "ios" || value === "android";
}

function isLoadTestPhase(
  value: unknown,
): value is "BASELINE" | "POST_MITIGATION" {
  return value === "BASELINE" || value === "POST_MITIGATION";
}

function truncateAnonymousId(anonymousUserId: string): string {
  if (anonymousUserId.length <= 12) {
    return anonymousUserId;
  }
  return `${anonymousUserId.slice(0, 8)}...${anonymousUserId.slice(-4)}`;
}

function parseWindowDays(
  queryValue: unknown,
  res: Response,
  maxDays: number = 90,
): number | null {
  if (queryValue === undefined) {
    return 7;
  }

  if (typeof queryValue !== "string") {
    res.status(400).json({
      error: "Invalid request",
      message: "Query parameter 'window_days' must be a single integer value.",
    });
    return null;
  }

  const parsedWindowDays = Number.parseInt(queryValue, 10);
  if (!Number.isInteger(parsedWindowDays) || parsedWindowDays <= 0 || parsedWindowDays > maxDays) {
    res.status(400).json({
      error: "Invalid request",
      message: `Query parameter 'window_days' must be an integer between 1 and ${maxDays}.`,
    });
    return null;
  }

  return parsedWindowDays;
}

function requireDashboardToken(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env.DASHBOARD_TOKEN;
  if (!expectedToken) {
    res.status(503).json({
      error: "Service Unavailable",
      message: "Dashboard token is not configured.",
    });
    return;
  }

  const providedToken = req.header("x-dashboard-token");
  if (!providedToken || providedToken !== expectedToken) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid dashboard token.",
    });
    return;
  }

  next();
}

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/v1/assignment", async (req, res, next) => {
  const { anonymous_user_id, session_id, platform, app_version, install_id } = req.body ?? {};

  if (typeof anonymous_user_id !== "string" || !anonymous_user_id.trim()) {
    return res.status(400).json({
      error: "Invalid request",
      message: "Field 'anonymous_user_id' is required and must be non-empty.",
    });
  }

  if (platform !== undefined && !validatePlatform(platform)) {
    return res.status(400).json({
      error: "Invalid request",
      message: "Field 'platform' must be one of: ios, android.",
    });
  }

  const optionalFields = [
    { key: "app_version", value: app_version },
    { key: "session_id", value: session_id },
    { key: "install_id", value: install_id },
  ];
  for (const field of optionalFields) {
    if (field.value !== undefined && typeof field.value !== "string") {
      return res.status(400).json({
        error: "Invalid request",
        message: `Field '${field.key}' must be a string value.`,
      });
    }
  }

  const anonymousUserId = anonymous_user_id.trim();
  try {
    const assignmentPayload = await getAssignmentPayload({
      anonymous_user_id: anonymousUserId,
      session_id,
      platform,
      app_version,
      install_id,
    });
    const selectedVariants = assignmentPayload.assignments.map(
      (assignment) => `${assignment.experiment_id}:${assignment.variant_id}`,
    );

    console.log(
      `assignment request anonymous_user_id=${truncateAnonymousId(anonymousUserId)} variants=${selectedVariants.join(",")}`,
    );

    return res.status(200).json({
      anonymous_user_id: anonymousUserId,
      assignment_version: assignmentPayload.assignment_version,
      generated_at: new Date().toISOString(),
      assignments: assignmentPayload.assignments,
      config: assignmentPayload.config,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return res.status(503).json({
        error: "Service Unavailable",
        message: "Database is temporarily unavailable. Please retry.",
      });
    }

    return next(error);
  }
});

app.post("/v1/events", async (req, res, next) => {
  const rawAnonymousUserId =
    typeof req.body?.anonymous_user_id === "string" ? req.body.anonymous_user_id.trim() : "";

  try {
    const ingestionResult = await ingestEventBatch(req.body);

    console.log(
      `events ingest anonymous_user_id=${truncateAnonymousId(rawAnonymousUserId || "unknown")} accepted=${ingestionResult.accepted} rejected=${ingestionResult.rejected}`,
    );

    return res.status(200).json({
      ok: true,
      received_at: ingestionResult.received_at,
      accepted: ingestionResult.accepted,
      rejected: ingestionResult.rejected,
      results: ingestionResult.results,
    });
  } catch (error) {
    if (error instanceof EventValidationError) {
      return res.status(400).json({
        error: "Invalid request",
        message: error.message,
      });
    }

    if (isDatabaseUnavailableError(error)) {
      return res.status(503).json({
        error: "Service Unavailable",
        message: "Database is temporarily unavailable. Please retry.",
      });
    }

    return next(error);
  }
});

app.get("/v1/metrics/summary", async (req, res, next) => {
  const windowDays = parseWindowDays(req.query.window_days, res, 90);
  if (windowDays === null) {
    return;
  }

  try {
    const summary = await getSummaryMetrics(windowDays);
    return res.status(200).json(summary);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return res.status(503).json({
        error: "Service Unavailable",
        message: "Database is temporarily unavailable. Please retry.",
      });
    }
    return next(error);
  }
});

app.get("/v1/metrics/daily", requireDashboardToken, async (req, res, next) => {
  const windowDays = parseWindowDays(req.query.window_days, res, 90);
  if (windowDays === null) {
    return;
  }

  try {
    const metrics = await getDailyMetrics(windowDays);
    return res.status(200).json(metrics);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return res.status(503).json({
        error: "Service Unavailable",
        message: "Database is temporarily unavailable. Please retry.",
      });
    }
    return next(error);
  }
});

app.get("/v1/metrics/experiments", requireDashboardToken, async (req, res, next) => {
  const windowDays = parseWindowDays(req.query.window_days, res, 90);
  if (windowDays === null) {
    return;
  }

  const experimentId =
    typeof req.query.experiment_id === "string" && req.query.experiment_id.trim()
      ? req.query.experiment_id.trim()
      : undefined;

  try {
    const metrics = await getExperimentMetrics(windowDays, experimentId);
    return res.status(200).json(metrics);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return res.status(503).json({
        error: "Service Unavailable",
        message: "Database is temporarily unavailable. Please retry.",
      });
    }
    return next(error);
  }
});

app.get("/v1/metrics/funnels", requireDashboardToken, async (req, res, next) => {
  const windowDays = parseWindowDays(req.query.window_days, res, 90);
  if (windowDays === null) {
    return;
  }

  const funnelName =
    typeof req.query.funnel_name === "string" && req.query.funnel_name.trim()
      ? req.query.funnel_name.trim()
      : undefined;

  try {
    const metrics = await getFunnelMetrics(windowDays, funnelName);
    return res.status(200).json(metrics);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return res.status(503).json({
        error: "Service Unavailable",
        message: "Database is temporarily unavailable. Please retry.",
      });
    }
    return next(error);
  }
});

app.get("/v1/metrics/load-tests/runs", requireDashboardToken, async (req, res, next) => {
  const limitRaw = req.query.limit;
  const limit =
    typeof limitRaw === "string" && Number.isInteger(Number.parseInt(limitRaw, 10))
      ? Math.min(Math.max(Number.parseInt(limitRaw, 10), 1), 100)
      : 20;
  const scenarioName =
    typeof req.query.scenario_name === "string" && req.query.scenario_name.trim()
      ? req.query.scenario_name.trim()
      : undefined;
  const phaseRaw = req.query.phase;
  if (phaseRaw !== undefined && !isLoadTestPhase(phaseRaw)) {
    return res.status(400).json({
      error: "Invalid request",
      message: "Query parameter 'phase' must be BASELINE or POST_MITIGATION.",
    });
  }
  const phase = isLoadTestPhase(phaseRaw) ? phaseRaw : undefined;

  try {
    const runs = await getLoadTestRuns({
      limit,
      scenarioName,
      phase,
    });
    return res.status(200).json(runs);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return res.status(503).json({
        error: "Service Unavailable",
        message: "Database is temporarily unavailable. Please retry.",
      });
    }
    return next(error);
  }
});

app.get("/v1/metrics/load-tests/latest", requireDashboardToken, async (req, res, next) => {
  const phaseRaw = req.query.phase;
  if (phaseRaw !== undefined && !isLoadTestPhase(phaseRaw)) {
    return res.status(400).json({
      error: "Invalid request",
      message: "Query parameter 'phase' must be BASELINE or POST_MITIGATION.",
    });
  }
  const phase = isLoadTestPhase(phaseRaw) ? phaseRaw : undefined;

  try {
    const latest = await getLatestLoadTests(phase);
    return res.status(200).json(latest);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return res.status(503).json({
        error: "Service Unavailable",
        message: "Database is temporarily unavailable. Please retry.",
      });
    }
    return next(error);
  }
});

app.get("/v1/metrics/load-tests/compare", requireDashboardToken, async (req, res, next) => {
  const baselineRunId =
    typeof req.query.baseline_run_id === "string" ? req.query.baseline_run_id.trim() : "";
  const candidateRunId =
    typeof req.query.candidate_run_id === "string" ? req.query.candidate_run_id.trim() : "";
  if (!baselineRunId || !candidateRunId) {
    return res.status(400).json({
      error: "Invalid request",
      message:
        "Query parameters 'baseline_run_id' and 'candidate_run_id' are required.",
    });
  }

  try {
    const comparison = await getLoadTestComparison({
      baselineRunId,
      candidateRunId,
    });
    return res.status(200).json(comparison);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return res.status(503).json({
        error: "Service Unavailable",
        message: "Database is temporarily unavailable. Please retry.",
      });
    }
    return next(error);
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (
    err instanceof SyntaxError &&
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    "type" in err &&
    (err as { type?: unknown }).type === "entity.parse.failed"
  ) {
    return res.status(400).json({
      error: "Invalid request",
      message: "Malformed JSON body.",
    });
  }

  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: "An unexpected error occurred.",
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
