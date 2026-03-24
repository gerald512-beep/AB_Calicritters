import express, { Express, NextFunction, Request, Response } from "express";

export type Platform = "ios" | "android";

export function createBaseApp(serviceName: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      console.log(
        `[${new Date().toISOString()}] [${serviceName}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`,
      );
    });
    next();
  });
  return app;
}

export function validatePlatform(value: unknown): value is Platform {
  return value === "ios" || value === "android";
}

export function truncateAnonymousId(anonymousUserId: string): string {
  if (anonymousUserId.length <= 12) {
    return anonymousUserId;
  }
  return `${anonymousUserId.slice(0, 8)}...${anonymousUserId.slice(-4)}`;
}

export function registerErrorHandler(app: Express): void {
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (
      err instanceof SyntaxError &&
      typeof err === "object" &&
      err !== null &&
      "type" in err &&
      (err as { type?: unknown }).type === "entity.parse.failed"
    ) {
      res.status(400).json({
        error: "Invalid request",
        message: "Malformed JSON body.",
      });
      return;
    }

    console.error("Unhandled error:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred.",
    });
  });
}
