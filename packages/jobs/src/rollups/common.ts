import { RollupRunStatus } from "@prisma/client";
import prisma from "../db/prisma";

export const FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_EVENT_AGE_DAYS = 180;

export type RollupWindow = {
  windowStart: Date;
  windowEnd: Date;
  now: Date;
};

export type JobResult = {
  rowsWritten: number;
  ignoredCount: number;
};

export function getValidityBounds(now: Date): { futureBound: Date; oldestAllowed: Date } {
  return {
    futureBound: new Date(now.getTime() + FUTURE_SKEW_MS),
    oldestAllowed: new Date(now.getTime() - MAX_EVENT_AGE_DAYS * 24 * 60 * 60 * 1000),
  };
}

export async function countIgnoredEvents(window: RollupWindow): Promise<number> {
  const { futureBound, oldestAllowed } = getValidityBounds(window.now);
  return prisma.eventLog.count({
    where: {
      occurred_at: {
        gte: window.windowStart,
        lt: window.windowEnd,
      },
      OR: [
        {
          occurred_at: {
            gt: futureBound,
          },
        },
        {
          occurred_at: {
            lt: oldestAllowed,
          },
        },
      ],
    },
  });
}

export async function runTrackedJob(
  jobName: string,
  window: RollupWindow,
  execute: () => Promise<JobResult>,
): Promise<JobResult> {
  const run = await prisma.rollupRun.create({
    data: {
      job_name: jobName,
      status: RollupRunStatus.RUNNING,
      window_start: window.windowStart,
      window_end: window.windowEnd,
    },
  });

  try {
    const result = await execute();
    await prisma.rollupRun.update({
      where: { id: run.id },
      data: {
        status: RollupRunStatus.SUCCESS,
        finished_at: new Date(),
        rows_written: result.rowsWritten,
        ignored_count: result.ignoredCount,
      },
    });
    return result;
  } catch (error) {
    await prisma.rollupRun.update({
      where: { id: run.id },
      data: {
        status: RollupRunStatus.FAILED,
        finished_at: new Date(),
        error_text: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
