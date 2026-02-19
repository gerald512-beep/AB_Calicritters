-- CreateEnum
CREATE TYPE "RollupRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "daily_metric_rollups" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "metric_name" TEXT NOT NULL,
    "dimension_key" TEXT NOT NULL DEFAULT 'overall',
    "dimensions" JSONB,
    "value" DOUBLE PRECISION NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_metric_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_metric_rollups" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "dimensions" JSONB,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_metric_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_rollups" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "funnel_name" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "dimension_key" TEXT NOT NULL DEFAULT 'overall',
    "experiment_id" TEXT,
    "variant_id" TEXT,
    "users_count" INTEGER NOT NULL,
    "events_count" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rollup_runs" (
    "id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" "RollupRunStatus" NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "rows_written" INTEGER NOT NULL DEFAULT 0,
    "ignored_count" INTEGER NOT NULL DEFAULT 0,
    "error_text" TEXT,

    CONSTRAINT "rollup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_metric_rollups_day_idx" ON "daily_metric_rollups"("day");

-- CreateIndex
CREATE INDEX "daily_metric_rollups_metric_name_idx" ON "daily_metric_rollups"("metric_name");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metric_rollups_day_metric_name_dimension_key_key" ON "daily_metric_rollups"("day", "metric_name", "dimension_key");

-- CreateIndex
CREATE INDEX "experiment_metric_rollups_day_idx" ON "experiment_metric_rollups"("day");

-- CreateIndex
CREATE INDEX "experiment_metric_rollups_experiment_id_idx" ON "experiment_metric_rollups"("experiment_id");

-- CreateIndex
CREATE INDEX "experiment_metric_rollups_variant_id_idx" ON "experiment_metric_rollups"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_metric_rollups_day_experiment_id_variant_id_metr_key" ON "experiment_metric_rollups"("day", "experiment_id", "variant_id", "metric_name");

-- CreateIndex
CREATE INDEX "funnel_rollups_day_idx" ON "funnel_rollups"("day");

-- CreateIndex
CREATE INDEX "funnel_rollups_experiment_id_idx" ON "funnel_rollups"("experiment_id");

-- CreateIndex
CREATE INDEX "funnel_rollups_variant_id_idx" ON "funnel_rollups"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "funnel_rollups_day_funnel_name_step_name_dimension_key_key" ON "funnel_rollups"("day", "funnel_name", "step_name", "dimension_key");

-- CreateIndex
CREATE INDEX "rollup_runs_job_name_idx" ON "rollup_runs"("job_name");

-- CreateIndex
CREATE INDEX "rollup_runs_started_at_idx" ON "rollup_runs"("started_at");
