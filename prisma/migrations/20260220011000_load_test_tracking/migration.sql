-- CreateEnum
CREATE TYPE "LoadTestRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "LoadTestPhase" AS ENUM ('BASELINE', 'POST_MITIGATION');

-- CreateTable
CREATE TABLE "load_test_runs" (
    "id" TEXT NOT NULL,
    "run_name" TEXT NOT NULL,
    "scenario_name" TEXT NOT NULL,
    "phase" "LoadTestPhase" NOT NULL,
    "status" "LoadTestRunStatus" NOT NULL,
    "target_base_url" TEXT NOT NULL,
    "git_sha" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "tags" JSONB,
    "artifacts_path" TEXT,
    "notes" TEXT,
    "error_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "load_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_test_endpoint_metrics" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "requests_total" INTEGER NOT NULL,
    "success_count" INTEGER,
    "error_count" INTEGER,
    "timeout_count" INTEGER,
    "error_rate" DOUBLE PRECISION,
    "min_ms" DOUBLE PRECISION,
    "max_ms" DOUBLE PRECISION,
    "mean_ms" DOUBLE PRECISION,
    "p50_ms" DOUBLE PRECISION,
    "p95_ms" DOUBLE PRECISION,
    "p99_ms" DOUBLE PRECISION,
    "rps" DOUBLE PRECISION,
    "response_codes" JSONB,
    "error_breakdown" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_test_endpoint_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_test_data_checks" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "check_name" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "observed_value" DOUBLE PRECISION,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_test_data_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "load_test_runs_phase_started_at_idx" ON "load_test_runs"("phase", "started_at");

-- CreateIndex
CREATE INDEX "load_test_runs_status_started_at_idx" ON "load_test_runs"("status", "started_at");

-- CreateIndex
CREATE INDEX "load_test_runs_scenario_name_started_at_idx" ON "load_test_runs"("scenario_name", "started_at");

-- CreateIndex
CREATE INDEX "load_test_endpoint_metrics_run_id_idx" ON "load_test_endpoint_metrics"("run_id");

-- CreateIndex
CREATE INDEX "load_test_endpoint_metrics_endpoint_method_idx" ON "load_test_endpoint_metrics"("endpoint", "method");

-- CreateIndex
CREATE UNIQUE INDEX "load_test_endpoint_metrics_run_id_method_endpoint_key" ON "load_test_endpoint_metrics"("run_id", "method", "endpoint");

-- CreateIndex
CREATE INDEX "load_test_data_checks_run_id_idx" ON "load_test_data_checks"("run_id");

-- CreateIndex
CREATE INDEX "load_test_data_checks_check_name_idx" ON "load_test_data_checks"("check_name");

-- CreateIndex
CREATE UNIQUE INDEX "load_test_data_checks_run_id_check_name_key" ON "load_test_data_checks"("run_id", "check_name");

-- AddForeignKey
ALTER TABLE "load_test_endpoint_metrics" ADD CONSTRAINT "load_test_endpoint_metrics_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "load_test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_test_data_checks" ADD CONSTRAINT "load_test_data_checks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "load_test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
