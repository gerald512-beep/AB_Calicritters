import prisma from "../db/prisma";

type DailyMetricRow = {
  day: Date;
  metric_name: string;
  dimension_key: string;
  value: number;
  dimensions: unknown;
};

type ExperimentMetricRow = {
  day: Date;
  experiment_id: string;
  variant_id: string;
  metric_name: string;
  value: number;
  dimensions: unknown;
};

function startOfUtcDay(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function addDays(input: Date, days: number): Date {
  return new Date(input.getTime() + days * 24 * 60 * 60 * 1000);
}

function windowBounds(windowDays: number): { windowStart: Date; windowEnd: Date } {
  const now = new Date();
  const windowEnd = addDays(startOfUtcDay(now), 1);
  const windowStart = addDays(windowEnd, -windowDays);
  return { windowStart, windowEnd };
}

function isoDay(input: Date): string {
  return input.toISOString().slice(0, 10);
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export async function getDailyMetrics(windowDays: number): Promise<{
  generated_at: string;
  window_start: string;
  window_end: string;
  no_data: boolean;
  days: Array<{
    day: string;
    metrics: Record<string, number | Record<string, number>>;
  }>;
}> {
  const { windowStart, windowEnd } = windowBounds(windowDays);
  const rows = (await prisma.dailyMetricRollup.findMany({
    where: {
      day: {
        gte: windowStart,
        lt: windowEnd,
      },
    },
    orderBy: [{ day: "asc" }, { metric_name: "asc" }, { dimension_key: "asc" }],
  })) as DailyMetricRow[];

  const byDay = new Map<string, { day: string; metrics: Record<string, number | Record<string, number>> }>();
  for (const row of rows) {
    const dayKey = isoDay(row.day);
    const bucket = byDay.get(dayKey) ?? { day: dayKey, metrics: {} };

    if (row.metric_name === "event_volume_by_name") {
      const current = bucket.metrics.event_volume_by_name;
      const map =
        current && typeof current === "object" && !Array.isArray(current)
          ? (current as Record<string, number>)
          : {};
      map[row.dimension_key] = row.value;
      bucket.metrics.event_volume_by_name = map;
    } else {
      bucket.metrics[row.metric_name] = row.value;
    }

    byDay.set(dayKey, bucket);
  }

  return {
    generated_at: new Date().toISOString(),
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    no_data: rows.length === 0,
    days: Array.from(byDay.values()),
  };
}

export async function getExperimentMetrics(
  windowDays: number,
  experimentId?: string,
): Promise<{
  generated_at: string;
  window_start: string;
  window_end: string;
  no_data: boolean;
  experiments: Array<{
    experiment_id: string;
    status: string;
    start_at: string | null;
    end_at: string | null;
    targeting: unknown;
    variants: Array<{
      variant_id: string;
      variant_name: string;
      weight: number;
      is_control: boolean;
    }>;
    latest_day: string | null;
    latest_metrics_by_variant: Record<string, Record<string, number>>;
    series: Array<{
      day: string;
      variant_id: string;
      metric_name: string;
      value: number;
      dimensions: Record<string, unknown> | null;
    }>;
  }>;
}> {
  const { windowStart, windowEnd } = windowBounds(windowDays);
  const experiments = await prisma.experiment.findMany({
    where: experimentId ? { experiment_id: experimentId } : undefined,
    include: {
      variants: {
        orderBy: { variant_id: "asc" },
      },
    },
    orderBy: { experiment_id: "asc" },
  });

  const rows = (await prisma.experimentMetricRollup.findMany({
    where: {
      day: {
        gte: windowStart,
        lt: windowEnd,
      },
      ...(experimentId ? { experiment_id: experimentId } : {}),
    },
    orderBy: [{ experiment_id: "asc" }, { day: "asc" }, { variant_id: "asc" }, { metric_name: "asc" }],
  })) as ExperimentMetricRow[];

  const rowsByExperiment = new Map<string, ExperimentMetricRow[]>();
  for (const row of rows) {
    const bucket = rowsByExperiment.get(row.experiment_id) ?? [];
    bucket.push(row);
    rowsByExperiment.set(row.experiment_id, bucket);
  }

  const responseExperiments = experiments.map((experiment) => {
    const expRows = rowsByExperiment.get(experiment.experiment_id) ?? [];
    const latestDay = expRows.length > 0 ? expRows[expRows.length - 1].day : null;
    const latestDayKey = latestDay ? isoDay(latestDay) : null;
    const latestMetricsByVariant: Record<string, Record<string, number>> = {};

    for (const row of expRows) {
      const rowDay = isoDay(row.day);
      if (latestDayKey && rowDay === latestDayKey) {
        latestMetricsByVariant[row.variant_id] = latestMetricsByVariant[row.variant_id] ?? {};
        latestMetricsByVariant[row.variant_id][row.metric_name] = row.value;
      }
    }

    return {
      experiment_id: experiment.experiment_id,
      status: experiment.status,
      start_at: experiment.start_at ? experiment.start_at.toISOString() : null,
      end_at: experiment.end_at ? experiment.end_at.toISOString() : null,
      targeting: experiment.targeting,
      variants: experiment.variants.map((variant) => ({
        variant_id: variant.variant_id,
        variant_name: variant.variant_name,
        weight: variant.weight,
        is_control: variant.is_control,
      })),
      latest_day: latestDay ? latestDay.toISOString() : null,
      latest_metrics_by_variant: latestMetricsByVariant,
      series: expRows.map((row) => ({
        day: isoDay(row.day),
        variant_id: row.variant_id,
        metric_name: row.metric_name,
        value: row.value,
        dimensions: toObject(row.dimensions),
      })),
    };
  });

  return {
    generated_at: new Date().toISOString(),
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    no_data: rows.length === 0,
    experiments: responseExperiments,
  };
}

export async function getFunnelMetrics(
  windowDays: number,
  funnelName?: string,
): Promise<{
  generated_at: string;
  window_start: string;
  window_end: string;
  no_data: boolean;
  rows: Array<{
    day: string;
    funnel_name: string;
    step_name: string;
    experiment_id: string | null;
    variant_id: string | null;
    users_count: number;
    events_count: number;
  }>;
}> {
  const { windowStart, windowEnd } = windowBounds(windowDays);
  const rows = await prisma.funnelRollup.findMany({
    where: {
      day: {
        gte: windowStart,
        lt: windowEnd,
      },
      ...(funnelName ? { funnel_name: funnelName } : {}),
    },
    orderBy: [{ day: "asc" }, { funnel_name: "asc" }, { step_name: "asc" }, { dimension_key: "asc" }],
  });

  return {
    generated_at: new Date().toISOString(),
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    no_data: rows.length === 0,
    rows: rows.map((row) => ({
      day: isoDay(row.day),
      funnel_name: row.funnel_name,
      step_name: row.step_name,
      experiment_id: row.experiment_id,
      variant_id: row.variant_id,
      users_count: row.users_count,
      events_count: row.events_count,
    })),
  };
}

export async function getSummaryMetrics(windowDays: number): Promise<{
  generated_at: string;
  metrics: Array<{
    metric_name: string;
    value: number;
    dimensions: Record<string, unknown>;
  }>;
}> {
  const daily = await getDailyMetrics(windowDays);
  if (daily.days.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      metrics: [],
    };
  }

  const latestDay = daily.days[daily.days.length - 1];
  const sessionsSubmittedTotal = daily.days.reduce((sum, day) => {
    const value = day.metrics.sessions_submitted;
    return sum + (typeof value === "number" ? value : 0);
  }, 0);

  const metrics: Array<{
    metric_name: string;
    value: number;
    dimensions: Record<string, unknown>;
  }> = [];

  const loggingRate = latestDay.metrics.logging_rate_24h;
  if (typeof loggingRate === "number") {
    metrics.push({
      metric_name: "logging_rate_24h",
      value: loggingRate,
      dimensions: {
        overall: true,
        day: latestDay.day,
        window_days: windowDays,
      },
    });
  }

  const dau = latestDay.metrics.dau;
  if (typeof dau === "number") {
    metrics.push({
      metric_name: "dau",
      value: dau,
      dimensions: {
        day: latestDay.day,
      },
    });
  }

  metrics.push({
    metric_name: "sessions_submitted_total",
    value: sessionsSubmittedTotal,
    dimensions: {
      window_days: windowDays,
    },
  });

  const lagP50 = latestDay.metrics.ingestion_lag_p50;
  if (typeof lagP50 === "number") {
    metrics.push({
      metric_name: "ingestion_lag_p50",
      value: lagP50,
      dimensions: {
        day: latestDay.day,
        unit: "seconds",
      },
    });
  }

  const lagP95 = latestDay.metrics.ingestion_lag_p95;
  if (typeof lagP95 === "number") {
    metrics.push({
      metric_name: "ingestion_lag_p95",
      value: lagP95,
      dimensions: {
        day: latestDay.day,
        unit: "seconds",
      },
    });
  }

  const experiments = await getExperimentMetrics(windowDays);
  for (const experiment of experiments.experiments) {
    for (const [variantId, values] of Object.entries(experiment.latest_metrics_by_variant)) {
      const value = values.logging_rate_24h_by_variant;
      if (typeof value !== "number") {
        continue;
      }
      metrics.push({
        metric_name: "logging_rate_24h",
        value,
        dimensions: {
          experiment_id: experiment.experiment_id,
          variant_id: variantId,
          day: experiment.latest_day,
          window_days: windowDays,
        },
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    metrics,
  };
}
