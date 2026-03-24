import "dotenv/config";
import { EventValidationError, ingestEventBatch } from "./services/eventIngestionService";
import { isDatabaseUnavailableError } from "./utils/dbErrors";
import { createBaseApp, registerErrorHandler, truncateAnonymousId } from "./common/apiCommon";

const app = createBaseApp("events-api");
const port = Number(process.env.PORT) || 3003;
const serviceVariant = process.env.SERVICE_VARIANT || "stable";

app.use((_req, res, next) => {
  res.setHeader("x-events-service-variant", serviceVariant);
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service_variant: serviceVariant });
});

app.post("/v1/events", async (req, res, next) => {
  const rawAnonymousUserId =
    typeof req.body?.anonymous_user_id === "string" ? req.body.anonymous_user_id.trim() : "";

  try {
    const ingestionResult = await ingestEventBatch(req.body);
    console.log(
      `events ingest anonymous_user_id=${truncateAnonymousId(rawAnonymousUserId || "unknown")} variant=${serviceVariant} accepted=${ingestionResult.accepted} rejected=${ingestionResult.rejected}`,
    );
    res.status(200).json({
      ok: true,
      received_at: ingestionResult.received_at,
      accepted: ingestionResult.accepted,
      rejected: ingestionResult.rejected,
      results: ingestionResult.results,
    });
    return;
  } catch (error) {
    if (error instanceof EventValidationError) {
      res.status(400).json({
        error: "Invalid request",
        message: error.message,
      });
      return;
    }
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
  console.log(`Events API (${serviceVariant}) running on http://localhost:${port}`);
});
