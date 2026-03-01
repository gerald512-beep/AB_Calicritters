import { LoadTestPhase, Prisma } from "@prisma/client";
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

type LoadTestRunWithRelations = Prisma.LoadTestRunGetPayload<{
  include: { endpoint_metrics: true; data_checks: true };
}>;

function mapLoadTestRun(run: LoadTestRunWithRelations) {
  return {
    id: run.id,
    run_name: run.run_name,
    scenario_name: run.scenario_name,
    phase: run.phase,
    status: run.status,
    target_base_url: run.target_base_url,
    git_sha: run.git_sha,
    started_at: run.started_at.toISOString(),
    ended_at: run.ended_at ? run.ended_at.toISOString() : null,
    duration_ms: run.duration_ms,
    artifacts_path: run.artifacts_path,
    tags: toObject(run.tags),
    notes: run.notes,
    error_text: run.error_text,
    endpoint_metrics: run.endpoint_metrics.map((metric) => ({
      endpoint: metric.endpoint,
      method: metric.method,
      requests_total: metric.requests_total,
      success_count: metric.success_count,
      error_count: metric.error_count,
      timeout_count: metric.timeout_count,
      error_rate: metric.error_rate,
      min_ms: metric.min_ms,
      max_ms: metric.max_ms,
      mean_ms: metric.mean_ms,
      p50_ms: metric.p50_ms,
      p95_ms: metric.p95_ms,
      p99_ms: metric.p99_ms,
      rps: metric.rps,
      response_codes: toObject(metric.response_codes),
      error_breakdown: toObject(metric.error_breakdown),
    })),
    data_checks: run.data_checks.map((check) => ({
      check_name: check.check_name,
      passed: check.passed,
      observed_value: check.observed_value,
      details: toObject(check.details),
    })),
  };
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

export async function getLoadTestRuns(params: {
  limit: number;
  scenarioName?: string;
  phase?: LoadTestPhase;
}): Promise<{
  generated_at: string;
  runs: Array<ReturnType<typeof mapLoadTestRun>>;
}> {
  const runs = await prisma.loadTestRun.findMany({
    where: {
      ...(params.scenarioName ? { scenario_name: params.scenarioName } : {}),
      ...(params.phase ? { phase: params.phase } : {}),
    },
    include: {
      endpoint_metrics: {
        orderBy: [{ method: "asc" }, { endpoint: "asc" }],
      },
      data_checks: {
        orderBy: [{ check_name: "asc" }],
      },
    },
    orderBy: [{ started_at: "desc" }],
    take: params.limit,
  });

  return {
    generated_at: new Date().toISOString(),
    runs: runs.map((run) => mapLoadTestRun(run)),
  };
}

export async function getLatestLoadTests(phase?: LoadTestPhase): Promise<{
  generated_at: string;
  by_phase: Record<string, ReturnType<typeof mapLoadTestRun> | null>;
}> {
  if (phase) {
    const run = await prisma.loadTestRun.findFirst({
      where: { phase },
      include: {
        endpoint_metrics: {
          orderBy: [{ method: "asc" }, { endpoint: "asc" }],
        },
        data_checks: {
          orderBy: [{ check_name: "asc" }],
        },
      },
      orderBy: [{ started_at: "desc" }],
    });

    return {
      generated_at: new Date().toISOString(),
      by_phase: {
        [phase]: run ? mapLoadTestRun(run) : null,
      },
    };
  }

  const [baselineRun, postRun] = await Promise.all([
    prisma.loadTestRun.findFirst({
      where: { phase: LoadTestPhase.BASELINE },
      include: {
        endpoint_metrics: {
          orderBy: [{ method: "asc" }, { endpoint: "asc" }],
        },
        data_checks: {
          orderBy: [{ check_name: "asc" }],
        },
      },
      orderBy: [{ started_at: "desc" }],
    }),
    prisma.loadTestRun.findFirst({
      where: { phase: LoadTestPhase.POST_MITIGATION },
      include: {
        endpoint_metrics: {
          orderBy: [{ method: "asc" }, { endpoint: "asc" }],
        },
        data_checks: {
          orderBy: [{ check_name: "asc" }],
        },
      },
      orderBy: [{ started_at: "desc" }],
    }),
  ]);

  return {
    generated_at: new Date().toISOString(),
    by_phase: {
      BASELINE: baselineRun ? mapLoadTestRun(baselineRun) : null,
      POST_MITIGATION: postRun ? mapLoadTestRun(postRun) : null,
    },
  };
}

export async function getLoadTestComparison(params: {
  baselineRunId: string;
  candidateRunId: string;
}): Promise<{
  generated_at: string;
  baseline: ReturnType<typeof mapLoadTestRun>;
  candidate: ReturnType<typeof mapLoadTestRun>;
  endpoint_deltas: Array<{
    method: string;
    endpoint: string;
    baseline_p95_ms: number | null;
    candidate_p95_ms: number | null;
    delta_p95_ms: number | null;
    baseline_p99_ms: number | null;
    candidate_p99_ms: number | null;
    delta_p99_ms: number | null;
    baseline_error_rate: number | null;
    candidate_error_rate: number | null;
    delta_error_rate: number | null;
    baseline_rps: number | null;
    candidate_rps: number | null;
    delta_rps: number | null;
  }>;
  check_deltas: Array<{
    check_name: string;
    baseline_passed: boolean | null;
    candidate_passed: boolean | null;
    baseline_observed: number | null;
    candidate_observed: number | null;
  }>;
}> {
  const [baselineRun, candidateRun] = await Promise.all([
    prisma.loadTestRun.findUniqueOrThrow({
      where: { id: params.baselineRunId },
      include: {
        endpoint_metrics: true,
        data_checks: true,
      },
    }),
    prisma.loadTestRun.findUniqueOrThrow({
      where: { id: params.candidateRunId },
      include: {
        endpoint_metrics: true,
        data_checks: true,
      },
    }),
  ]);

  const baselineMapped = mapLoadTestRun(baselineRun);
  const candidateMapped = mapLoadTestRun(candidateRun);

  const baselineMetricMap = new Map(
    baselineMapped.endpoint_metrics.map((metric) => [`${metric.method}|${metric.endpoint}`, metric]),
  );
  const candidateMetricMap = new Map(
    candidateMapped.endpoint_metrics.map((metric) => [`${metric.method}|${metric.endpoint}`, metric]),
  );
  const endpointKeys = Array.from(new Set([...baselineMetricMap.keys(), ...candidateMetricMap.keys()])).sort();

  const endpointDeltas = endpointKeys.map((key) => {
    const baseline = baselineMetricMap.get(key) ?? null;
    const candidate = candidateMetricMap.get(key) ?? null;
    const [method, endpoint] = key.split("|");
    return {
      method,
      endpoint,
      baseline_p95_ms: baseline?.p95_ms ?? null,
      candidate_p95_ms: candidate?.p95_ms ?? null,
      delta_p95_ms:
        baseline?.p95_ms !== null &&
        baseline?.p95_ms !== undefined &&
        candidate?.p95_ms !== null &&
        candidate?.p95_ms !== undefined
          ? candidate.p95_ms - baseline.p95_ms
          : null,
      baseline_p99_ms: baseline?.p99_ms ?? null,
      candidate_p99_ms: candidate?.p99_ms ?? null,
      delta_p99_ms:
        baseline?.p99_ms !== null &&
        baseline?.p99_ms !== undefined &&
        candidate?.p99_ms !== null &&
        candidate?.p99_ms !== undefined
          ? candidate.p99_ms - baseline.p99_ms
          : null,
      baseline_error_rate: baseline?.error_rate ?? null,
      candidate_error_rate: candidate?.error_rate ?? null,
      delta_error_rate:
        baseline?.error_rate !== null &&
        baseline?.error_rate !== undefined &&
        candidate?.error_rate !== null &&
        candidate?.error_rate !== undefined
          ? candidate.error_rate - baseline.error_rate
          : null,
      baseline_rps: baseline?.rps ?? null,
      candidate_rps: candidate?.rps ?? null,
      delta_rps:
        baseline?.rps !== null &&
        baseline?.rps !== undefined &&
        candidate?.rps !== null &&
        candidate?.rps !== undefined
          ? candidate.rps - baseline.rps
          : null,
    };
  });

  const baselineChecks = new Map(
    baselineMapped.data_checks.map((check) => [check.check_name, check]),
  );
  const candidateChecks = new Map(
    candidateMapped.data_checks.map((check) => [check.check_name, check]),
  );
  const checkNames = Array.from(new Set([...baselineChecks.keys(), ...candidateChecks.keys()])).sort();
  const checkDeltas = checkNames.map((checkName) => ({
    check_name: checkName,
    baseline_passed: baselineChecks.get(checkName)?.passed ?? null,
    candidate_passed: candidateChecks.get(checkName)?.passed ?? null,
    baseline_observed: baselineChecks.get(checkName)?.observed_value ?? null,
    candidate_observed: candidateChecks.get(checkName)?.observed_value ?? null,
  }));

  return {
    generated_at: new Date().toISOString(),
    baseline: baselineMapped,
    candidate: candidateMapped,
    endpoint_deltas: endpointDeltas,
    check_deltas: checkDeltas,
  };
}
