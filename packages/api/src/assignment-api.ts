import "dotenv/config";
import { getAssignmentPayload } from "./services/assignmentService";
import { isDatabaseUnavailableError } from "./utils/dbErrors";
import {
  createBaseApp,
  registerErrorHandler,
  truncateAnonymousId,
  validatePlatform,
} from "./common/apiCommon";

const app = createBaseApp("assignment-api");
const port = Number(process.env.PORT) || 3002;

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/v1/assignment", async (req, res, next) => {
  const { anonymous_user_id, session_id, platform, app_version, install_id } = req.body ?? {};

  if (typeof anonymous_user_id !== "string" || !anonymous_user_id.trim()) {
    res.status(400).json({
      error: "Invalid request",
      message: "Field 'anonymous_user_id' is required and must be non-empty.",
    });
    return;
  }

  if (platform !== undefined && !validatePlatform(platform)) {
    res.status(400).json({
      error: "Invalid request",
      message: "Field 'platform' must be one of: ios, android.",
    });
    return;
  }

  const optionalFields = [
    { key: "app_version", value: app_version },
    { key: "session_id", value: session_id },
    { key: "install_id", value: install_id },
  ];
  for (const field of optionalFields) {
    if (field.value !== undefined && typeof field.value !== "string") {
      res.status(400).json({
        error: "Invalid request",
        message: `Field '${field.key}' must be a string value.`,
      });
      return;
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

    res.status(200).json({
      anonymous_user_id: anonymousUserId,
      assignment_version: assignmentPayload.assignment_version,
      generated_at: new Date().toISOString(),
      assignments: assignmentPayload.assignments,
      config: assignmentPayload.config,
    });
    return;
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({
        error: "Service Unavailable",
        message: "Database is temporarily unavailable. Please retry.",
      });
      return;
    }
    next(error);
  }
});

registerErrorHandler(app);

app.listen(port, () => {
  console.log(`Assignment API running on http://localhost:${port}`);
});
