import {
  apiGet,
  type LoadTestRun,
  type LoadTestRunsResponse,
  type LoadTestComparisonResponse,
} from "../../lib/api";

export const dynamic = "force-dynamic";
const SCENARIOS = ["assignment", "events", "mixed"] as const;
type ScenarioName = (typeof SCENARIOS)[number];
type ScenarioEvidence = {
  scenario: ScenarioName;
  baseline: LoadTestRun | null;
  candidate: LoadTestRun | null;
  comparison: LoadTestComparisonResponse | null;
};

type ScenarioEvidenceWithPair = ScenarioEvidence & {
  baseline: LoadTestRun;
  candidate: LoadTestRun;
};

function formatMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(1)} ms`;
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number | null, digits: number = 2): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function formatSignedMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} ms`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatSignedNumber(value: number | null, digits: number = 2): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function runErrorRate(run: LoadTestRun | null): number | null {
  if (!run) {
    return null;
  }
  const metrics = run.endpoint_metrics;
  if (metrics.length === 0) {
    return null;
  }
  const totalRequests = metrics.reduce((sum, row) => sum + row.requests_total, 0);
  if (totalRequests <= 0) {
    return null;
  }
  const totalErrors = metrics.reduce((sum, row) => {
    if (typeof row.error_count === "number") {
      return sum + row.error_count;
    }
    if (typeof row.error_rate === "number") {
      return sum + row.error_rate * row.requests_total;
    }
    return sum;
  }, 0);
  return totalErrors / totalRequests;
}

function runP95(run: LoadTestRun | null): number | null {
  if (!run || run.endpoint_metrics.length === 0) {
    return null;
  }
  const rows = run.endpoint_metrics.filter(
    (row) => typeof row.p95_ms === "number" && row.requests_total > 0,
  );
  if (rows.length === 0) {
    return null;
  }
  const weightedNumerator = rows.reduce(
    (sum, row) => sum + (row.p95_ms as number) * row.requests_total,
    0,
  );
  const weightedDenominator = rows.reduce((sum, row) => sum + row.requests_total, 0);
  return weightedDenominator > 0 ? weightedNumerator / weightedDenominator : null;
}

function runRps(run: LoadTestRun | null): number | null {
  if (!run || run.endpoint_metrics.length === 0) {
    return null;
  }
  const values = run.endpoint_metrics
    .map((row) => row.rps)
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0);
}

function runGateSummary(run: LoadTestRun | null): { passed: number; total: number } {
  if (!run) {
    return { passed: 0, total: 0 };
  }
  const total = run.data_checks.length;
  const passed = run.data_checks.filter((check) => check.passed).length;
  return { passed, total };
}

function latestRunForScenario(
  runs: LoadTestRun[],
  scenario: ScenarioName,
  phase: "BASELINE" | "POST_MITIGATION",
): LoadTestRun | null {
  return (
    runs.find(
      (run) =>
        run.scenario_name === scenario &&
        run.phase === phase &&
        run.status === "SUCCESS",
    ) ?? null
  );
}

function average(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number");
  if (filtered.length === 0) {
    return null;
  }
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function delta(candidate: number | null, baseline: number | null): number | null {
  if (candidate === null || baseline === null) {
    return null;
  }
  return candidate - baseline;
}

function hasRunPair(row: ScenarioEvidence): row is ScenarioEvidenceWithPair {
  return row.baseline !== null && row.candidate !== null;
}

export default async function BenchmarksPage() {
  const runsResponse = await apiGet<LoadTestRunsResponse>("/v1/metrics/load-tests/runs?limit=60");
  const scenarioEvidence: ScenarioEvidence[] = await Promise.all(
    SCENARIOS.map(async (scenario) => {
      const baseline = latestRunForScenario(runsResponse.runs, scenario, "BASELINE");
      const candidate = latestRunForScenario(runsResponse.runs, scenario, "POST_MITIGATION");
      if (!baseline || !candidate) {
        return {
          scenario,
          baseline,
          candidate,
          comparison: null,
        };
      }

      const comparison = await apiGet<LoadTestComparisonResponse>(
        `/v1/metrics/load-tests/compare?baseline_run_id=${baseline.id}&candidate_run_id=${candidate.id}`,
      );
      return {
        scenario,
        baseline,
        candidate,
        comparison,
      };
    }),
  );

  const scenariosWithCompleteEvidence = scenarioEvidence.filter(hasRunPair);
  const avgDeltaP95 = average(
    scenariosWithCompleteEvidence.map((row) =>
      delta(runP95(row.candidate), runP95(row.baseline)),
    ),
  );
  const avgDeltaErrorRate = average(
    scenariosWithCompleteEvidence.map(
      (row) => delta(runErrorRate(row.candidate), runErrorRate(row.baseline)),
    ),
  );
  const postGatePassCount = scenariosWithCompleteEvidence.filter((row) => {
    const gates = runGateSummary(row.candidate);
    return gates.total > 0 && gates.passed === gates.total;
  }).length;

  return (
    <main>
      <h2>Benchmarks</h2>
      <p className="muted">
        Baseline vs post-mitigation stress tests for assignment and event ingestion endpoints.
      </p>

      <section className="grid">
        <article className="card">
          <h3>Scenarios With Evidence</h3>
          <div className="value">
            {scenariosWithCompleteEvidence.length}/{SCENARIOS.length}
          </div>
        </article>
        <article className="card">
          <h3>Post Gates Passing</h3>
          <div className="value">
            {postGatePassCount}/{SCENARIOS.length}
          </div>
        </article>
        <article className="card">
          <h3>Avg Delta p95</h3>
          <div className="value">{formatSignedMs(avgDeltaP95)}</div>
        </article>
        <article className="card">
          <h3>Avg Delta Error Rate</h3>
          <div className="value">{formatSignedPercent(avgDeltaErrorRate)}</div>
        </article>
      </section>

      <section className="section">
        <h3>Milestone 2 Evidence By Scenario</h3>
        <p className="muted">
          Explicit baseline vs post-mitigation evidence for assignment, events, and mixed scenarios.
        </p>
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Baseline Run</th>
              <th>Post Run</th>
              <th>Baseline Error %</th>
              <th>Post Error %</th>
              <th>Delta Error %</th>
              <th>Baseline p95</th>
              <th>Post p95</th>
              <th>Delta p95</th>
              <th>Baseline RPS</th>
              <th>Post RPS</th>
              <th>Delta RPS</th>
              <th>Baseline Gates</th>
              <th>Post Gates</th>
            </tr>
          </thead>
          <tbody>
            {scenarioEvidence.map((row) => {
              const baselineError = runErrorRate(row.baseline);
              const postError = runErrorRate(row.candidate);
              const baselineP95 = runP95(row.baseline);
              const postP95 = runP95(row.candidate);
              const baselineRps = runRps(row.baseline);
              const postRps = runRps(row.candidate);
              const baselineGates = runGateSummary(row.baseline);
              const postGates = runGateSummary(row.candidate);
              return (
                <tr key={row.scenario}>
                  <td>{row.scenario}</td>
                  <td>{row.baseline ? `${row.baseline.run_name} (${row.baseline.id})` : "-"}</td>
                  <td>{row.candidate ? `${row.candidate.run_name} (${row.candidate.id})` : "-"}</td>
                  <td>{formatPercent(baselineError)}</td>
                  <td>{formatPercent(postError)}</td>
                  <td>
                    {formatSignedPercent(
                      baselineError !== null && postError !== null ? postError - baselineError : null,
                    )}
                  </td>
                  <td>{formatMs(baselineP95)}</td>
                  <td>{formatMs(postP95)}</td>
                  <td>
                    {formatSignedMs(
                      baselineP95 !== null && postP95 !== null ? postP95 - baselineP95 : null,
                    )}
                  </td>
                  <td>{formatNumber(baselineRps)}</td>
                  <td>{formatNumber(postRps)}</td>
                  <td>
                    {formatSignedNumber(
                      baselineRps !== null && postRps !== null ? postRps - baselineRps : null,
                    )}
                  </td>
                  <td>{baselineGates.total > 0 ? `${baselineGates.passed}/${baselineGates.total}` : "-"}</td>
                  <td>{postGates.total > 0 ? `${postGates.passed}/${postGates.total}` : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="section">
        <h3>Endpoint Delta Evidence</h3>
        {scenarioEvidence.filter((row) => row.comparison).length === 0 ? (
          <p className="muted">No baseline/post pairs are available yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Method</th>
                <th>Endpoint</th>
                <th>Baseline p95</th>
                <th>Post p95</th>
                <th>Delta p95</th>
                <th>Baseline Error %</th>
                <th>Post Error %</th>
                <th>Delta Error %</th>
                <th>Delta RPS</th>
              </tr>
            </thead>
            <tbody>
              {scenarioEvidence.flatMap((row) => {
                if (!row.comparison) {
                  return [];
                }
                return row.comparison.endpoint_deltas.map((endpoint) => (
                  <tr key={`${row.scenario}-${endpoint.method}-${endpoint.endpoint}`}>
                    <td>{row.scenario}</td>
                    <td>{endpoint.method}</td>
                    <td>{endpoint.endpoint}</td>
                    <td>{formatMs(endpoint.baseline_p95_ms)}</td>
                    <td>{formatMs(endpoint.candidate_p95_ms)}</td>
                    <td>{formatSignedMs(endpoint.delta_p95_ms)}</td>
                    <td>{formatPercent(endpoint.baseline_error_rate)}</td>
                    <td>{formatPercent(endpoint.candidate_error_rate)}</td>
                    <td>{formatSignedPercent(endpoint.delta_error_rate)}</td>
                    <td>{formatSignedNumber(endpoint.delta_rps)}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h3>Gate Evidence</h3>
        {scenarioEvidence.filter((row) => row.comparison).length === 0 ? (
          <p className="muted">No baseline/post pairs are available yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Check</th>
                <th>Baseline</th>
                <th>Post</th>
                <th>Baseline Value</th>
                <th>Post Value</th>
              </tr>
            </thead>
            <tbody>
              {scenarioEvidence.flatMap((row) => {
                if (!row.comparison) {
                  return [];
                }
                return row.comparison.check_deltas.map((check) => (
                  <tr key={`${row.scenario}-${check.check_name}`}>
                    <td>{row.scenario}</td>
                    <td>{check.check_name}</td>
                    <td>{check.baseline_passed === null ? "-" : check.baseline_passed ? "pass" : "fail"}</td>
                    <td>{check.candidate_passed === null ? "-" : check.candidate_passed ? "pass" : "fail"}</td>
                    <td>{formatNumber(check.baseline_observed)}</td>
                    <td>{formatNumber(check.candidate_observed)}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h3>Recent Runs</h3>
        <table>
          <thead>
            <tr>
              <th>Run ID</th>
              <th>Run Name</th>
              <th>Phase</th>
              <th>Scenario</th>
              <th>Status</th>
              <th>Started</th>
              <th>Duration (ms)</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {runsResponse.runs.map((run) => (
              <tr key={run.id}>
                <td>{run.id}</td>
                <td>{run.run_name}</td>
                <td>{run.phase}</td>
                <td>{run.scenario_name}</td>
                <td>{run.status}</td>
                <td>{run.started_at}</td>
                <td>{run.duration_ms ?? "-"}</td>
                <td>{run.target_base_url}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
