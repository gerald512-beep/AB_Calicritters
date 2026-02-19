/**
 * Quick start:
 * curl -X POST "http://localhost:3000/v1/assignment" -H "Content-Type: application/json" -d "{\"anonymous_user_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"platform\":\"ios\",\"app_version\":\"0.1\"}"
 */
import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { getAssignmentPayload } from "./services/assignmentService";
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

function truncateAnonymousId(anonymousUserId: string): string {
  if (anonymousUserId.length <= 12) {
    return anonymousUserId;
  }
  return `${anonymousUserId.slice(0, 8)}...${anonymousUserId.slice(-4)}`;
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

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: "An unexpected error occurred.",
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
