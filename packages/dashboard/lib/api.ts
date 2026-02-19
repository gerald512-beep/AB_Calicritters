type ApiOptions = {
  requireToken?: boolean;
};

const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export async function apiGet<T>(path: string, options: ApiOptions = {}): Promise<T> {
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

  return (await response.json()) as T;
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
