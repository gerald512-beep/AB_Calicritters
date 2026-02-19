import "dotenv/config";
import prisma from "./db/prisma";
import { runRollups } from "./rollups";

function startOfUtcDay(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

async function snapshot(windowStart: Date, windowEnd: Date): Promise<{
  daily: number;
  experiment: number;
  funnel: number;
}> {
  const [daily, experiment, funnel] = await Promise.all([
    prisma.dailyMetricRollup.count({
      where: {
        day: {
          gte: windowStart,
          lt: windowEnd,
        },
      },
    }),
    prisma.experimentMetricRollup.count({
      where: {
        day: {
          gte: windowStart,
          lt: windowEnd,
        },
      },
    }),
    prisma.funnelRollup.count({
      where: {
        day: {
          gte: windowStart,
          lt: windowEnd,
        },
      },
    }),
  ]);

  return { daily, experiment, funnel };
}

async function main(): Promise<void> {
  const windowDays = 2;
  const now = new Date();
  const windowEnd = new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000);
  const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

  await runRollups({ windowDays, selectedJobs: ["daily", "experiment", "funnel"], now });
  const first = await snapshot(windowStart, windowEnd);

  await runRollups({ windowDays, selectedJobs: ["daily", "experiment", "funnel"], now });
  const second = await snapshot(windowStart, windowEnd);

  if (
    first.daily !== second.daily ||
    first.experiment !== second.experiment ||
    first.funnel !== second.funnel
  ) {
    throw new Error(
      `Idempotency check failed. first=${JSON.stringify(first)} second=${JSON.stringify(second)}`,
    );
  }

  console.log(`Idempotency check passed. snapshot=${JSON.stringify(second)}`);
}

main()
  .catch((error) => {
    console.error("check:idempotency failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
