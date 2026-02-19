import { Prisma } from "@prisma/client";
import prisma from "../db/prisma";
import { addDays, enumerateDays, toIsoDay } from "../utils/time";
import { countIgnoredEvents, getValidityBounds, type JobResult, type RollupWindow } from "./common";

type VariantMetricsRow = {
  cohort_size: number;
  users_active_d1: number;
  sessions_submitted_d7: number;
  converted_24h: number;
};

type CountRow = { count: number };

async function upsertExperimentMetric(params: {
  day: Date;
  experimentId: string;
  variantId: string;
  metricName: string;
  value: number;
  dimensions?: Prisma.InputJsonValue;
}): Promise<void> {
  const { day, experimentId, variantId, metricName, value, dimensions = Prisma.JsonNull } = params;
  await prisma.experimentMetricRollup.upsert({
    where: {
      experiment_metric_rollup_unique: {
        day,
        experiment_id: experimentId,
        variant_id: variantId,
        metric_name: metricName,
      },
    },
    create: {
      day,
      experiment_id: experimentId,
      variant_id: variantId,
      metric_name: metricName,
      value,
      dimensions,
    },
    update: {
      value,
      dimensions,
      computed_at: new Date(),
    },
  });
}

export async function runExperimentMetricsRollup(window: RollupWindow): Promise<JobResult> {
  const { futureBound, oldestAllowed } = getValidityBounds(window.now);
  const ignoredCount = await countIgnoredEvents(window);
  const days = enumerateDays(window.windowStart, window.windowEnd);
  const runningExperiments = await prisma.experiment.findMany({
    where: { status: "RUNNING" },
    include: { variants: true },
    orderBy: { experiment_id: "asc" },
  });

  let rowsWritten = 0;

  for (const experiment of runningExperiments) {
    for (const variant of experiment.variants) {
      for (const dayStart of days) {
        const dayEnd = addDays(dayStart, 1);

        const usersAssignedRows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT COUNT(*)::INT AS count
          FROM assignments
          WHERE experiment_id = ${experiment.experiment_id}
            AND variant_id = ${variant.variant_id}
            AND assigned_at < ${dayEnd}
        `);
        const usersAssigned = usersAssignedRows[0]?.count ?? 0;

        const variantRows = await prisma.$queryRaw<VariantMetricsRow[]>(Prisma.sql`
          WITH first_seen AS (
            SELECT anonymous_user_id, MIN(occurred_at) AS first_seen_at
            FROM event_logs
            WHERE occurred_at <= ${futureBound}
              AND occurred_at >= ${oldestAllowed}
            GROUP BY anonymous_user_id
          ),
          cohort AS (
            SELECT fs.anonymous_user_id, fs.first_seen_at
            FROM first_seen fs
            INNER JOIN assignments a
              ON a.anonymous_user_id = fs.anonymous_user_id
            WHERE a.experiment_id = ${experiment.experiment_id}
              AND a.variant_id = ${variant.variant_id}
              AND fs.first_seen_at >= ${dayStart}
              AND fs.first_seen_at < ${dayEnd}
          )
          SELECT
            COUNT(*)::INT AS cohort_size,
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1
                FROM event_logs e
                WHERE e.anonymous_user_id = cohort.anonymous_user_id
                  AND e.occurred_at > cohort.first_seen_at
                  AND e.occurred_at <= cohort.first_seen_at + INTERVAL '1 day'
                  AND e.occurred_at <= ${futureBound}
                  AND e.occurred_at >= ${oldestAllowed}
              )
            )::INT AS users_active_d1,
            COALESCE((
              SELECT COUNT(*)
              FROM cohort c
              INNER JOIN event_logs e
                ON e.anonymous_user_id = c.anonymous_user_id
              WHERE e.event_name = 'session_submitted'
                AND e.occurred_at >= c.first_seen_at
                AND e.occurred_at <= c.first_seen_at + INTERVAL '7 day'
                AND e.occurred_at <= ${futureBound}
                AND e.occurred_at >= ${oldestAllowed}
            ), 0)::INT AS sessions_submitted_d7,
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
            )::INT AS converted_24h
          FROM cohort
        `);

        const variantMetrics = variantRows[0] ?? {
          cohort_size: 0,
          users_active_d1: 0,
          sessions_submitted_d7: 0,
          converted_24h: 0,
        };
        const loggingRateByVariant =
          variantMetrics.cohort_size > 0
            ? variantMetrics.converted_24h / variantMetrics.cohort_size
            : 0;

        const dimensions = {
          day: toIsoDay(dayStart),
          cohort_size: variantMetrics.cohort_size,
        } as Prisma.InputJsonValue;

        await upsertExperimentMetric({
          day: dayStart,
          experimentId: experiment.experiment_id,
          variantId: variant.variant_id,
          metricName: "users_assigned",
          value: usersAssigned,
          dimensions,
        });
        await upsertExperimentMetric({
          day: dayStart,
          experimentId: experiment.experiment_id,
          variantId: variant.variant_id,
          metricName: "users_active_d1",
          value: variantMetrics.users_active_d1,
          dimensions,
        });
        await upsertExperimentMetric({
          day: dayStart,
          experimentId: experiment.experiment_id,
          variantId: variant.variant_id,
          metricName: "sessions_submitted_d7",
          value: variantMetrics.sessions_submitted_d7,
          dimensions,
        });
        await upsertExperimentMetric({
          day: dayStart,
          experimentId: experiment.experiment_id,
          variantId: variant.variant_id,
          metricName: "logging_rate_24h_by_variant",
          value: loggingRateByVariant,
          dimensions: {
            day: toIsoDay(dayStart),
            cohort_size: variantMetrics.cohort_size,
            converted_users: variantMetrics.converted_24h,
          } as Prisma.InputJsonValue,
        });
        rowsWritten += 4;
      }
    }
  }

  return {
    rowsWritten,
    ignoredCount,
  };
}
