import { apiGet, type DailyMetricsResponse, type FunnelMetricsResponse } from "../../lib/api";

export const dynamic = "force-dynamic";

type EventVolume = Record<string, number>;

function mergeEventVolume(days: DailyMetricsResponse["days"]): EventVolume {
  const volume: EventVolume = {};
  for (const day of days) {
    const byName = day.metrics.event_volume_by_name;
    if (!byName || typeof byName !== "object" || Array.isArray(byName)) {
      continue;
    }
    for (const [eventName, count] of Object.entries(byName)) {
      if (typeof count !== "number") {
        continue;
      }
      volume[eventName] = (volume[eventName] ?? 0) + count;
    }
  }
  return volume;
}

export default async function IngestionPage() {
  const [daily, funnels] = await Promise.all([
    apiGet<DailyMetricsResponse>("/v1/metrics/daily?window_days=14"),
    apiGet<FunnelMetricsResponse>("/v1/metrics/funnels?window_days=14&funnel_name=core_journey"),
  ]);

  const volumeByName = mergeEventVolume(daily.days);
  const volumeRows = Object.entries(volumeByName).sort((a, b) => b[1] - a[1]);
  const overallFunnelRows = funnels.rows.filter(
    (row) => row.funnel_name === "core_journey" && row.experiment_id === null && row.variant_id === null,
  );

  return (
    <main>
      <h2>Ingestion</h2>
      <p className="muted">Event volume, unique users, and ingestion lag rollups.</p>

      {daily.no_data ? (
        <p>No data yet. Run jobs rollup first.</p>
      ) : (
        <>
          <section className="section">
            <h3>Unique Users and Lag by Day</h3>
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>DAU</th>
                  <th>Lag p50 (s)</th>
                  <th>Lag p95 (s)</th>
                </tr>
              </thead>
              <tbody>
                {daily.days.map((day) => (
                  <tr key={day.day}>
                    <td>{day.day}</td>
                    <td>{typeof day.metrics.dau === "number" ? day.metrics.dau : "-"}</td>
                    <td>
                      {typeof day.metrics.ingestion_lag_p50 === "number"
                        ? day.metrics.ingestion_lag_p50.toFixed(1)
                        : "-"}
                    </td>
                    <td>
                      {typeof day.metrics.ingestion_lag_p95 === "number"
                        ? day.metrics.ingestion_lag_p95.toFixed(1)
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="section">
            <h3>Event Volume by Name (14d total)</h3>
            <table>
              <thead>
                <tr>
                  <th>Event Name</th>
                  <th>Events</th>
                </tr>
              </thead>
              <tbody>
                {volumeRows.map(([eventName, count]) => (
                  <tr key={eventName}>
                    <td>{eventName}</td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <section className="section">
        <h3>Core Funnel (Overall)</h3>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Step</th>
              <th>Users</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {overallFunnelRows.map((row) => (
              <tr key={`${row.day}-${row.step_name}`}>
                <td>{row.day}</td>
                <td>{row.step_name}</td>
                <td>{row.users_count}</td>
                <td>{row.events_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
