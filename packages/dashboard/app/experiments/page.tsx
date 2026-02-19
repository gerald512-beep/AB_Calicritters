import { apiGet, type ExperimentMetricsResponse } from "../../lib/api";

export const dynamic = "force-dynamic";

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${(value * 100).toFixed(1)}%`;
}

export default async function ExperimentsPage() {
  const data = await apiGet<ExperimentMetricsResponse>("/v1/metrics/experiments?window_days=7");

  return (
    <main>
      <h2>Experiments</h2>
      <p className="muted">Status, targeting, variants, assignment counts, and latest conversion slices.</p>

      {data.no_data && <p>No aggregated experiment metrics yet. Run jobs rollup first.</p>}

      {data.experiments.map((experiment) => (
        <section className="section card" key={experiment.experiment_id}>
          <h3>{experiment.experiment_id}</h3>
          <p className="muted">
            Status: {experiment.status} | Start: {experiment.start_at ?? "null"} | End:{" "}
            {experiment.end_at ?? "null"}
          </p>
          <p className="muted">Targeting: {JSON.stringify(experiment.targeting)}</p>
          <p className="muted">Latest rollup day: {experiment.latest_day ?? "n/a"}</p>

          <table>
            <thead>
              <tr>
                <th>Variant</th>
                <th>Name</th>
                <th>Control</th>
                <th>Weight</th>
                <th>Users Assigned</th>
                <th>Users Active D1</th>
                <th>Sessions Submitted D7</th>
                <th>Logging Rate 24h</th>
              </tr>
            </thead>
            <tbody>
              {experiment.variants.map((variant) => {
                const latest = experiment.latest_metrics_by_variant[variant.variant_id] ?? {};
                const usersAssigned =
                  typeof latest.users_assigned === "number" ? latest.users_assigned : null;
                const usersActiveD1 =
                  typeof latest.users_active_d1 === "number" ? latest.users_active_d1 : null;
                const sessionsSubmittedD7 =
                  typeof latest.sessions_submitted_d7 === "number" ? latest.sessions_submitted_d7 : null;
                const loggingRate =
                  typeof latest.logging_rate_24h_by_variant === "number"
                    ? latest.logging_rate_24h_by_variant
                    : null;

                return (
                  <tr key={variant.variant_id}>
                    <td>{variant.variant_id}</td>
                    <td>{variant.variant_name}</td>
                    <td>{variant.is_control ? "yes" : "no"}</td>
                    <td>{variant.weight}</td>
                    <td>{usersAssigned ?? "-"}</td>
                    <td>{usersActiveD1 ?? "-"}</td>
                    <td>{sessionsSubmittedD7 ?? "-"}</td>
                    <td>{formatPercent(loggingRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
