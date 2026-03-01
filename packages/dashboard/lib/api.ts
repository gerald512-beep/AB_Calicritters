type ApiOptions = {
  requireToken?: boolean;
  cacheTtlMs?: number;
  forceRefresh?: boolean;
};

const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const DEFAULT_CACHE_TTL_MS = 5_000;

type CacheEntry = {
  expiresAt: number;
  payload: unknown;
};

const responseCache = new Map<string, CacheEntry>();

export async function apiGet<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheKey = `${options.requireToken === false ? "public" : "token"}:${path}`;
  const now = Date.now();

  if (!options.forceRefresh && cacheTtlMs > 0) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.payload as T;
    }
  }

  const headers: Record<string, string> = {};
  if (options.requireToken !== false) {
    const token = process.env.DASHBOARD_TOKEN;
    if (!token) {
      throw new Error("DASHBOARD_TOKEN is missing for dashboard server-side requests.");
    }
    headers["x-dashboard-token"] = token;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${path} failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as T;
  if (cacheTtlMs > 0) {
    responseCache.set(cacheKey, {
      expiresAt: now + cacheTtlMs,
      payload,
    });
  }
  return payload;
}

export type SummaryMetric = {
  metric_name: string;
  value: number;
  dimensions: Record<string, unknown>;
};

export type SummaryResponse = {
  generated_at: string;
  metrics: SummaryMetric[];
};

export type DailyMetricsResponse = {
  generated_at: string;
  window_start: string;
  window_end: string;
  no_data: boolean;
  days: Array<{
    day: string;
    metrics: Record<string, number | Record<string, number>>;
  }>;
};

export type ExperimentMetricsResponse = {
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
};

export type FunnelMetricsResponse = {
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
};

export type LoadTestEndpointMetric = {
  endpoint: string;
  method: string;
  requests_total: number;
  success_count: number | null;
  error_count: number | null;
  timeout_count: number | null;
  error_rate: number | null;
  min_ms: number | null;
  max_ms: number | null;
  mean_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  rps: number | null;
  response_codes: Record<string, unknown> | null;
  error_breakdown: Record<string, unknown> | null;
};

export type LoadTestDataCheck = {
  check_name: string;
  passed: boolean;
  observed_value: number | null;
  details: Record<string, unknown> | null;
};

export type LoadTestRun = {
  id: string;
  run_name: string;
  scenario_name: string;
  phase: "BASELINE" | "POST_MITIGATION";
  status: "RUNNING" | "SUCCESS" | "FAILED";
  target_base_url: string;
  git_sha: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  artifacts_path: string | null;
  tags: Record<string, unknown> | null;
  notes: string | null;
  error_text: string | null;
  endpoint_metrics: LoadTestEndpointMetric[];
  data_checks: LoadTestDataCheck[];
};

export type LoadTestRunsResponse = {
  generated_at: string;
  runs: LoadTestRun[];
};

export type LoadTestLatestResponse = {
  generated_at: string;
  by_phase: Record<string, LoadTestRun | null>;
};

export type LoadTestComparisonResponse = {
  generated_at: string;
  baseline: LoadTestRun;
  candidate: LoadTestRun;
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
};
