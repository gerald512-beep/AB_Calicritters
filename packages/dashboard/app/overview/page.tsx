import { apiGet, type DailyMetricsResponse, type SummaryResponse } from "../../lib/api";

export const dynamic = "force-dynamic";

function findSummaryMetric(
  summary: SummaryResponse,
  metricName: string,
  matcher?: (dimensions: Record<string, unknown>) => boolean,
): number | null {
  const row = summary.metrics.find(
    (metric) => metric.metric_name === metricName && (matcher ? matcher(metric.dimensions) : true),
  );
  return row ? row.value : null;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null, digits: number = 0): string {
  if (value === null) {
    return "-";
  }
  return value.toFixed(digits);
}

export default async function OverviewPage() {
  const [summary, daily] = await Promise.all([
    apiGet<SummaryResponse>("/v1/metrics/summary?window_days=7", { requireToken: false }),
    apiGet<DailyMetricsResponse>("/v1/metrics/daily?window_days=7"),
  ]);

  const loggingRate = findSummaryMetric(summary, "logging_rate_24h", (d) => d.overall === true);
  const dauLatest = findSummaryMetric(summary, "dau");
  const sessionsSubmittedTotal = findSummaryMetric(summary, "sessions_submitted_total");
  const lagP50 = findSummaryMetric(summary, "ingestion_lag_p50");
  const lagP95 = findSummaryMetric(summary, "ingestion_lag_p95");

  return (
    <main>
      <section className="grid">
        <article className="card">
          <h3>Logging Rate 24h</h3>
          <div className="value">{formatPercent(loggingRate)}</div>
        </article>
        <article className="card">
          <h3>DAU (Latest Day)</h3>
          <div className="value">{formatNumber(dauLatest)}</div>
        </article>
        <article className="card">
          <h3>Sessions Submitted (7d)</h3>
          <div className="value">{formatNumber(sessionsSubmittedTotal)}</div>
        </article>
        <article className="card">
          <h3>Ingestion Lag p50 / p95 (s)</h3>
          <div className="value">
            {formatNumber(lagP50, 1)} / {formatNumber(lagP95, 1)}
          </div>
        </article>
      </section>

      <section className="section">
        <h2>Daily Trend (7d)</h2>
        <p className="muted">Source: aggregated daily_metric_rollups</p>
        {daily.no_data ? (
          <p>No data yet. Run jobs rollup first.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>DAU</th>
                <th>New Users</th>
                <th>Sessions Submitted</th>
                <th>Logging Rate 24h</th>
              </tr>
            </thead>
            <tbody>
              {daily.days.map((day) => {
                const dau = typeof day.metrics.dau === "number" ? day.metrics.dau : 0;
                const newUsers = typeof day.metrics.new_users === "number" ? day.metrics.new_users : 0;
                const sessions =
                  typeof day.metrics.sessions_submitted === "number" ? day.metrics.sessions_submitted : 0;
                const rate =
                  typeof day.metrics.logging_rate_24h === "number" ? day.metrics.logging_rate_24h : 0;

                return (
                  <tr key={day.day}>
                    <td>{day.day}</td>
                    <td>{dau}</td>
                    <td>{newUsers}</td>
                    <td>{sessions}</td>
                    <td>{(rate * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
