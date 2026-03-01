import { runDailyMetricsRollup } from "./dailyMetricsRollup";
import { runExperimentMetricsRollup } from "./experimentMetricsRollup";
import { runFunnelRollup } from "./funnelRollup";
import { runTrackedJob, type JobResult, type RollupWindow } from "./common";
import { addDays, startOfUtcDay } from "../utils/time";
import prisma from "../db/prisma";

export type JobName = "daily" | "experiment" | "funnel";

export type RollupSummary = {
  window_start: string;
  window_end: string;
  jobs: Array<{
    job_name: JobName;
    rows_written: number;
    ignored_count: number;
  }>;
};

const ROLLUP_LOCK_NAMESPACE = 4_391;
const ROLLUP_LOCK_KEY = 2_026_020;

function buildWindow(windowDays: number, now: Date): RollupWindow {
  const nextUtcDayStart = addDays(startOfUtcDay(now), 1);
  const windowStart = addDays(nextUtcDayStart, -windowDays);
  return {
    windowStart,
    windowEnd: nextUtcDayStart,
    now,
  };
}

export async function runRollups(params: {
  windowDays: number;
  selectedJobs: JobName[];
  now?: Date;
}): Promise<RollupSummary> {
  const lockRows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${ROLLUP_LOCK_NAMESPACE}, ${ROLLUP_LOCK_KEY}) AS acquired
  `;
  const acquired = lockRows[0]?.acquired ?? false;
  if (!acquired) {
    throw new Error("Another rollup run is currently in progress. Retry after the current run completes.");
  }

  const now = params.now ?? new Date();
  const window = buildWindow(params.windowDays, now);
  const jobs: RollupSummary["jobs"] = [];

  try {
    for (const job of params.selectedJobs) {
      let result: JobResult;
      if (job === "daily") {
        result = await runTrackedJob("daily_metrics_rollup", window, () => runDailyMetricsRollup(window));
      } else if (job === "experiment") {
        result = await runTrackedJob("experiment_metrics_rollup", window, () =>
          runExperimentMetricsRollup(window),
        );
      } else {
        result = await runTrackedJob("funnel_rollup", window, () => runFunnelRollup(window));
      }

      jobs.push({
        job_name: job,
        rows_written: result.rowsWritten,
        ignored_count: result.ignoredCount,
      });
    }
  } finally {
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(${ROLLUP_LOCK_NAMESPACE}, ${ROLLUP_LOCK_KEY})
    `;
  }

  return {
    window_start: window.windowStart.toISOString(),
    window_end: window.windowEnd.toISOString(),
    jobs,
  };
}
