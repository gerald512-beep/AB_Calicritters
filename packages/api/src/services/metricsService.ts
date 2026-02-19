import { Prisma } from "@prisma/client";
import prisma from "../db/prisma";
import { toJsonObject, type JsonObject } from "../utils/deepMerge";

const DEFAULT_WINDOW_DAYS = 7;
const EXPERIMENT_SEGMENTS = ["exp_3_landing_journey", "exp_4_achievements_density"] as const;

type CohortRow = {
  anonymous_user_id: string;
  first_seen_at: Date;
  converted: boolean;
};

type DauRow = {
  day: Date;
  dau: number;
};

type MetricRecordInput = {
  metric_name: string;
  window_start: Date;
  window_end: Date;
  dimensions: JsonObject | null;
  value: number;
};

type MetricResponseRow = {
  metric_name: string;
  value: number;
  dimensions: JsonObject | null;
};

function normalizeExperimentMap(value: unknown): Record<string, string> {
  const objectValue = toJsonObject(value);
  const normalized: Record<string, string> = {};

  for (const [key, val] of Object.entries(objectValue)) {
    if (typeof val === "string") {
      normalized[key] = val;
    }
  }

  return normalized;
}

async function loadCohort(windowStart: Date, windowEnd: Date): Promise<CohortRow[]> {
  return prisma.$queryRaw<CohortRow[]>(Prisma.sql`
    WITH first_seen AS (
      SELECT
        anonymous_user_id,
        MIN(occurred_at) AS first_seen_at
      FROM event_logs
      GROUP BY anonymous_user_id
    ),
    cohort AS (
      SELECT
        anonymous_user_id,
        first_seen_at
      FROM first_seen
      WHERE first_seen_at >= ${windowStart}
        AND first_seen_at < ${windowEnd}
    )
    SELECT
      c.anonymous_user_id,
      c.first_seen_at,
      EXISTS (
        SELECT 1
        FROM event_logs e
        WHERE e.anonymous_user_id = c.anonymous_user_id
          AND e.event_name = 'session_submitted'
          AND e.occurred_at >= c.first_seen_at
          AND e.occurred_at <= c.first_seen_at + INTERVAL '24 hours'
      ) AS converted
    FROM cohort c
  `);
}

async function loadDau(windowStart: Date, windowEnd: Date): Promise<DauRow[]> {
  return prisma.$queryRaw<DauRow[]>(Prisma.sql`
    SELECT
      DATE_TRUNC('day', occurred_at) AS day,
      COUNT(DISTINCT anonymous_user_id)::INT AS dau
    FROM event_logs
    WHERE occurred_at >= ${windowStart}
      AND occurred_at < ${windowEnd}
    GROUP BY 1
    ORDER BY 1 ASC
  `);
}

async function loadExperimentMaps(
  anonymousUserIds: string[],
): Promise<Map<string, Record<string, string>>> {
  if (anonymousUserIds.length === 0) {
    return new Map();
  }

  const rows = await prisma.$queryRaw<
    Array<{ anonymous_user_id: string; experiment_map: Prisma.JsonValue | null }>
  >(Prisma.sql`
    SELECT DISTINCT ON (anonymous_user_id)
      anonymous_user_id,
      experiment_map
    FROM event_logs
    WHERE anonymous_user_id IN (${Prisma.join(anonymousUserIds)})
      AND experiment_map IS NOT NULL
    ORDER BY anonymous_user_id ASC, occurred_at ASC
  `);

  const mapByUser = new Map<string, Record<string, string>>();
  for (const row of rows) {
    mapByUser.set(row.anonymous_user_id, normalizeExperimentMap(row.experiment_map));
  }

  return mapByUser;
}

function buildLoggingRateRows(params: {
  cohortRows: CohortRow[];
  mapByUser: Map<string, Record<string, string>>;
  windowStart: Date;
  windowEnd: Date;
  windowDays: number;
}): MetricRecordInput[] {
  const { cohortRows, mapByUser, windowStart, windowEnd, windowDays } = params;

  const totalUsers = cohortRows.length;
  const convertedUsers = cohortRows.filter((row) => row.converted).length;
  const overallRate = totalUsers > 0 ? convertedUsers / totalUsers : 0;

  const metricRows: MetricRecordInput[] = [
    {
      metric_name: "logging_rate_24h",
      value: overallRate,
      window_start: windowStart,
      window_end: windowEnd,
      dimensions: {
        overall: true,
        window_days: windowDays,
        cohort_size: totalUsers,
      },
    },
  ];

  for (const experimentId of EXPERIMENT_SEGMENTS) {
    const countsByVariant = new Map<string, { total: number; converted: number }>();

    for (const row of cohortRows) {
      const experimentMap = mapByUser.get(row.anonymous_user_id);
      const variantId = experimentMap?.[experimentId];
      if (!variantId) {
        continue;
      }

      const current = countsByVariant.get(variantId) ?? { total: 0, converted: 0 };
      current.total += 1;
      if (row.converted) {
        current.converted += 1;
      }
      countsByVariant.set(variantId, current);
    }

    for (const [variantId, counts] of countsByVariant.entries()) {
      metricRows.push({
        metric_name: "logging_rate_24h",
        value: counts.total > 0 ? counts.converted / counts.total : 0,
        window_start: windowStart,
        window_end: windowEnd,
        dimensions: {
          experiment_id: experimentId,
          variant_id: variantId,
          window_days: windowDays,
          cohort_size: counts.total,
        },
      });
    }
  }

  return metricRows;
}

function buildDauRows(
  dailyRows: DauRow[],
  windowStart: Date,
  windowEnd: Date,
): MetricRecordInput[] {
  return dailyRows.map((row) => ({
    metric_name: "dau",
    value: row.dau,
    window_start: windowStart,
    window_end: windowEnd,
    dimensions: {
      day: row.day.toISOString().slice(0, 10),
    },
  }));
}

export async function computeAndStoreMetricsSummary(windowDays: number = DEFAULT_WINDOW_DAYS): Promise<{
  generated_at: string;
  metrics: MetricResponseRow[];
}> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const windowEnd = now;

  const cohortRows = await loadCohort(windowStart, windowEnd);
  const mapByUser = await loadExperimentMaps(cohortRows.map((row) => row.anonymous_user_id));
  const dailyRows = await loadDau(windowStart, windowEnd);

  const metricsToStore = [
    ...buildLoggingRateRows({
      cohortRows,
      mapByUser,
      windowStart,
      windowEnd,
      windowDays,
    }),
    ...buildDauRows(dailyRows, windowStart, windowEnd),
  ];

  if (metricsToStore.length > 0) {
    await prisma.metricRollup.createMany({
      data: metricsToStore.map((metric) => ({
        metric_name: metric.metric_name,
        window_start: metric.window_start,
        window_end: metric.window_end,
        dimensions: metric.dimensions
          ? (metric.dimensions as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        value: metric.value,
      })),
    });
  }

  return {
    generated_at: now.toISOString(),
    metrics: metricsToStore.map((metric) => ({
      metric_name: metric.metric_name,
      value: metric.value,
      dimensions: metric.dimensions,
    })),
  };
}
