-- CreateTable
CREATE TABLE "event_logs" (
    "id" TEXT NOT NULL,
    "event_id" TEXT,
    "anonymous_user_id" TEXT NOT NULL,
    "session_id" TEXT,
    "install_id" TEXT,
    "platform" TEXT,
    "app_version" TEXT,
    "event_name" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "properties" JSONB,
    "context" JSONB,
    "assignment_version" INTEGER,
    "assignments" JSONB,
    "experiment_map" JSONB,
    "schema_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_rollups" (
    "id" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "dimensions" JSONB,
    "value" DOUBLE PRECISION NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_logs_event_id_key" ON "event_logs"("event_id");

-- CreateIndex
CREATE INDEX "event_logs_anonymous_user_id_idx" ON "event_logs"("anonymous_user_id");

-- CreateIndex
CREATE INDEX "event_logs_session_id_idx" ON "event_logs"("session_id");

-- CreateIndex
CREATE INDEX "event_logs_event_name_idx" ON "event_logs"("event_name");

-- CreateIndex
CREATE INDEX "event_logs_occurred_at_idx" ON "event_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "metric_rollups_metric_name_idx" ON "metric_rollups"("metric_name");

-- CreateIndex
CREATE INDEX "metric_rollups_window_start_idx" ON "metric_rollups"("window_start");

-- CreateIndex
CREATE INDEX "metric_rollups_window_end_idx" ON "metric_rollups"("window_end");
