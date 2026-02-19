import { Prisma } from "@prisma/client";
import prisma from "../db/prisma";
import { addDays, enumerateDays, toIsoDay } from "../utils/time";
import { countIgnoredEvents, getValidityBounds, type JobResult, type RollupWindow } from "./common";

type CountRow = { count: number };
type LoggingRateRow = { cohort_size: number; converted: number };
type LagRow = { p50: number; p95: number };
type EventVolumeRow = { event_name: string; events_count: number };

async function upsertDailyMetric(params: {
  day: Date;
  metricName: string;
  value: number;
  dimensionKey?: string;
  dimensions?: Prisma.InputJsonValue;
}): Promise<void> {
  const { day, metricName, value, dimensionKey = "overall", dimensions = Prisma.JsonNull } = params;
  await prisma.dailyMetricRollup.upsert({
    where: {
      daily_metric_rollup_unique: {
        day,
        metric_name: metricName,
        dimension_key: dimensionKey,
      },
    },
    create: {
      day,
      metric_name: metricName,
      dimension_key: dimensionKey,
      dimensions,
      value,
    },
    update: {
      value,
      dimensions,
      computed_at: new Date(),
    },
  });
}

async function queryDailyCount(params: {
  dayStart: Date;
  dayEnd: Date;
  futureBound: Date;
  oldestAllowed: Date;
  eventName?: string;
}): Promise<number> {
  const { dayStart, dayEnd, futureBound, oldestAllowed, eventName } = params;
  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COUNT(*)::INT AS count
    FROM event_logs
    WHERE occurred_at >= ${dayStart}
      AND occurred_at < ${dayEnd}
      AND occurred_at <= ${futureBound}
      AND occurred_at >= ${oldestAllowed}
      ${eventName ? Prisma.sql`AND event_name = ${eventName}` : Prisma.empty}
  `);
  return rows[0]?.count ?? 0;
}

export async function runDailyMetricsRollup(window: RollupWindow): Promise<JobResult> {
  const { futureBound, oldestAllowed } = getValidityBounds(window.now);
  const ignoredCount = await countIgnoredEvents(window);
  const days = enumerateDays(window.windowStart, window.windowEnd);
  let rowsWritten = 0;

  for (const dayStart of days) {
    const dayEnd = addDays(dayStart, 1);

    const dauRows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT anonymous_user_id)::INT AS count
      FROM event_logs
      WHERE occurred_at >= ${dayStart}
        AND occurred_at < ${dayEnd}
        AND occurred_at <= ${futureBound}
        AND occurred_at >= ${oldestAllowed}
    `);
    const dau = dauRows[0]?.count ?? 0;

    const newUsersRows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
      WITH first_seen AS (
        SELECT anonymous_user_id, MIN(occurred_at) AS first_seen_at
        FROM event_logs
        WHERE occurred_at <= ${futureBound}
          AND occurred_at >= ${oldestAllowed}
        GROUP BY anonymous_user_id
      )
      SELECT COUNT(*)::INT AS count
      FROM first_seen
      WHERE first_seen_at >= ${dayStart}
        AND first_seen_at < ${dayEnd}
    `);
    const newUsers = newUsersRows[0]?.count ?? 0;

    const sessionsSubmitted = await queryDailyCount({
      dayStart,
      dayEnd,
      futureBound,
      oldestAllowed,
      eventName: "session_submitted",
    });

    const loggingRows = await prisma.$queryRaw<LoggingRateRow[]>(Prisma.sql`
      WITH first_seen AS (
        SELECT anonymous_user_id, MIN(occurred_at) AS first_seen_at
        FROM event_logs
        WHERE occurred_at <= ${futureBound}
          AND occurred_at >= ${oldestAllowed}
        GROUP BY anonymous_user_id
      ),
      cohort AS (
        SELECT anonymous_user_id, first_seen_at
        FROM first_seen
        WHERE first_seen_at >= ${dayStart}
          AND first_seen_at < ${dayEnd}
      )
      SELECT
        COUNT(*)::INT AS cohort_size,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM event_logs e
            WHERE e.anonymous_user_id = cohort.anonymous_user_id
              AND e.event_name = 'session_submitted'
              AND e.occurred_at >= cohort.first_seen_at
              AND e.occurred_at <= cohort.first_seen_at + INTERVAL '24 hours'
              AND e.occurred_at <= ${futureBound}
              AND e.occurred_at >= ${oldestAllowed}
          )
        )::INT AS converted
      FROM cohort
    `);
    const cohortSize = loggingRows[0]?.cohort_size ?? 0;
    const converted = loggingRows[0]?.converted ?? 0;
    const loggingRate = cohortSize > 0 ? converted / cohortSize : 0;

    const lagRows = await prisma.$queryRaw<LagRow[]>(Prisma.sql`
      SELECT
        COALESCE(
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY GREATEST(EXTRACT(EPOCH FROM (received_at - occurred_at)), 0)
          ),
          0
        )::FLOAT AS p50,
        COALESCE(
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY GREATEST(EXTRACT(EPOCH FROM (received_at - occurred_at)), 0)
          ),
          0
        )::FLOAT AS p95
      FROM event_logs
      WHERE occurred_at >= ${dayStart}
        AND occurred_at < ${dayEnd}
        AND occurred_at <= ${futureBound}
        AND occurred_at >= ${oldestAllowed}
    `);
    const lagP50 = lagRows[0]?.p50 ?? 0;
    const lagP95 = lagRows[0]?.p95 ?? 0;

    const volumeRows = await prisma.$queryRaw<EventVolumeRow[]>(Prisma.sql`
      SELECT event_name, COUNT(*)::INT AS events_count
      FROM event_logs
      WHERE occurred_at >= ${dayStart}
        AND occurred_at < ${dayEnd}
        AND occurred_at <= ${futureBound}
        AND occurred_at >= ${oldestAllowed}
      GROUP BY event_name
      ORDER BY event_name ASC
    `);

    await upsertDailyMetric({ day: dayStart, metricName: "dau", value: dau });
    await upsertDailyMetric({ day: dayStart, metricName: "new_users", value: newUsers });
    await upsertDailyMetric({
      day: dayStart,
      metricName: "sessions_submitted",
      value: sessionsSubmitted,
    });
    await upsertDailyMetric({
      day: dayStart,
      metricName: "logging_rate_24h",
      value: loggingRate,
      dimensions: {
        cohort_size: cohortSize,
        converted_users: converted,
      } as Prisma.InputJsonValue,
    });
    await upsertDailyMetric({
      day: dayStart,
      metricName: "ingestion_lag_p50",
      value: lagP50,
      dimensions: {
        unit: "seconds",
      } as Prisma.InputJsonValue,
    });
    await upsertDailyMetric({
      day: dayStart,
      metricName: "ingestion_lag_p95",
      value: lagP95,
      dimensions: {
        unit: "seconds",
      } as Prisma.InputJsonValue,
    });
    rowsWritten += 6;

    await prisma.$transaction(async (tx) => {
      await tx.dailyMetricRollup.deleteMany({
        where: {
          day: dayStart,
          metric_name: "event_volume_by_name",
        },
      });

      if (volumeRows.length === 0) {
        return;
      }

      await tx.dailyMetricRollup.createMany({
        data: volumeRows.map((volumeRow) => ({
          day: dayStart,
          metric_name: "event_volume_by_name",
          dimension_key: volumeRow.event_name,
          dimensions: {
            event_name: volumeRow.event_name,
            day: toIsoDay(dayStart),
          } as Prisma.InputJsonValue,
          value: volumeRow.events_count,
        })),
      });
    });
    rowsWritten += volumeRows.length;
  }

  return {
    rowsWritten,
    ignoredCount,
  };
}
