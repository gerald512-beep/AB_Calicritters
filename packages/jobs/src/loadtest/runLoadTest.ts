import "dotenv/config";
import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { LoadTestPhase, LoadTestRunStatus, Prisma } from "@prisma/client";
import prisma from "../db/prisma";

type ScenarioName = "assignment" | "events" | "mixed";

type RunArgs = {
  scenario: ScenarioName;
  phase: LoadTestPhase;
  target: string;
  runName: string;
  notes?: string;
  tags: Record<string, string>;
};

type ArtillerySummary = {
  durationMs: number;
  overallRequests: number;
  overallErrors: number;
  overallErrorRate: number;
  timeoutCount: number;
  responseCodes: Record<string, number>;
  errorBreakdown: Record<string, number>;
  endpointMetrics: Array<{
    endpoint: string;
    method: string;
    requestsTotal: number;
    successCount: number | null;
    errorCount: number | null;
    errorRate: number | null;
    responseCodes: Record<string, number>;
    minMs: number | null;
    maxMs: number | null;
    meanMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    rps: number | null;
  }>;
};

function repoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..", "..");
}

function parsePhase(value: string | undefined): LoadTestPhase {
  const normalized = (value ?? "baseline").trim().toLowerCase();
  if (normalized === "baseline") {
    return LoadTestPhase.BASELINE;
  }
  if (normalized === "post_mitigation" || normalized === "post-mitigation") {
    return LoadTestPhase.POST_MITIGATION;
  }
  throw new Error("Invalid --phase. Use 'baseline' or 'post_mitigation'.");
}

function parseScenario(value: string | undefined): ScenarioName {
  const normalized = (value ?? "assignment").trim().toLowerCase();
  if (normalized === "assignment" || normalized === "events" || normalized === "mixed") {
    return normalized;
  }
  throw new Error("Invalid --scenario. Use 'assignment', 'events', or 'mixed'.");
}

function parseTags(tagValues: string[]): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const rawTag of tagValues) {
    const [key, value] = rawTag.split("=", 2);
    if (!key || value === undefined) {
      throw new Error(`Invalid --tag '${rawTag}'. Expected format key=value.`);
    }
    tags[key.trim()] = value.trim();
  }
  return tags;
}

function parseArgs(argv: string[]): RunArgs {
  let scenario: ScenarioName | null = null;
  let phase: LoadTestPhase | null = null;
  let target = "http://localhost:3000";
  let runName: string | null = null;
  let notes: string | undefined;
  const rawTags: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--scenario" && argv[i + 1]) {
      scenario = parseScenario(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--phase" && argv[i + 1]) {
      phase = parsePhase(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--target" && argv[i + 1]) {
      target = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--run-name" && argv[i + 1]) {
      runName = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--notes" && argv[i + 1]) {
      notes = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--tag" && argv[i + 1]) {
      rawTags.push(argv[i + 1]);
      i += 1;
      continue;
    }
  }

  const resolvedScenario = scenario ?? "assignment";
  const resolvedPhase = phase ?? LoadTestPhase.BASELINE;
  const startedAtIso = new Date().toISOString().replace(/[:.]/g, "-");
  const resolvedRunName =
    runName ?? `lt_${resolvedPhase.toLowerCase()}_${resolvedScenario}_${startedAtIso}`;

  return {
    scenario: resolvedScenario,
    phase: resolvedPhase,
    target,
    runName: resolvedRunName,
    notes,
    tags: parseTags(rawTags),
  };
}

function getGitSha(root: string): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

async function runArtillery(params: {
  root: string;
  scenario: ScenarioName;
  runId: string;
  phase: LoadTestPhase;
  target: string;
  startedAtIso: string;
  artifactsDir: string;
}): Promise<{ outputPath: string }> {
  const scenarioPath = path.join(
    params.root,
    "packages",
    "jobs",
    "loadtests",
    "scenarios",
    `${params.scenario}.json`,
  );
  const outputPath = path.join(params.artifactsDir, `${params.runId}.json`);
  const htmlPath = path.join(params.artifactsDir, `${params.runId}.html`);

  const env = {
    ...process.env,
    LOAD_TEST_RUN_ID: params.runId,
    LOAD_TEST_PHASE: params.phase,
    LOAD_TEST_SCENARIO: params.scenario,
    LOAD_TEST_STARTED_AT: params.startedAtIso,
  };

  execSync(
    `npx artillery run --target "${params.target}" "${scenarioPath}" --output "${outputPath}"`,
    {
      cwd: params.root,
      env,
      stdio: "inherit",
    },
  );

  execSync(`npx artillery report --output "${htmlPath}" "${outputPath}"`, {
    cwd: params.root,
    env,
    stdio: "inherit",
  });

  return { outputPath };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function parseCounterMap(
  aggregate: Record<string, unknown>,
  prefix: string,
): Record<string, number> {
  const source =
    (aggregate[prefix] as Record<string, number> | undefined) ??
    ((aggregate.counters as Record<string, number> | undefined) ?? {});

  if (prefix === "codes" || prefix === "errors") {
    const direct = aggregate[prefix];
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return Object.fromEntries(
        Object.entries(direct as Record<string, unknown>).filter(([, value]) => typeof value === "number"),
      ) as Record<string, number>;
    }
  }

  const map: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "number") {
      continue;
    }
    if (!key.startsWith(`http.${prefix}.`) && !key.startsWith(`${prefix}.`)) {
      continue;
    }
    const mapKey = key.split(".").slice(2).join(".") || key.split(".").slice(1).join(".");
    map[mapKey] = value;
  }
  return map;
}

function inferMethodForEndpoint(endpoint: string): string {
  if (endpoint === "/v1/assignment" || endpoint === "/v1/events") {
    return "POST";
  }
  if (endpoint === "/health") {
    return "GET";
  }
  return "ANY";
}

function parseEndpointCodeBreakdown(
  counters: Record<string, number>,
): Map<string, Record<string, number>> {
  const byEndpoint = new Map<string, Record<string, number>>();
  const pattern = /^plugins\.metrics-by-endpoint\.(.+)\.codes\.(\d{3})$/;

  for (const [counterKey, value] of Object.entries(counters)) {
    if (!Number.isFinite(value)) {
      continue;
    }
    const match = counterKey.match(pattern);
    if (!match) {
      continue;
    }

    const endpoint = match[1];
    const code = match[2];
    const current = byEndpoint.get(endpoint) ?? {};
    current[code] = value;
    byEndpoint.set(endpoint, current);
  }

  return byEndpoint;
}

function parseArtillerySummary(report: Record<string, unknown>, durationMs: number): ArtillerySummary {
  const aggregate =
    (report.aggregate as Record<string, unknown> | undefined) ??
    (report as Record<string, unknown>);
  const summaries =
    (aggregate.summaries as Record<string, Record<string, unknown>> | undefined) ?? {};
  const counters = (aggregate.counters as Record<string, number> | undefined) ?? {};
  const endpointCodeBreakdown = parseEndpointCodeBreakdown(counters);

  const codes = parseCounterMap(aggregate, "codes");
  const errors = parseCounterMap(aggregate, "errors");
  const timeoutCount = Object.entries(errors)
    .filter(([key]) => key.toLowerCase().includes("timeout"))
    .reduce((sum, [, value]) => sum + value, 0);

  const endpointMetrics: ArtillerySummary["endpointMetrics"] = [];
  const seenEndpointKeys = new Set<string>();
  for (const [key, value] of Object.entries(summaries)) {
    const match = key.match(/^http\.response_time\.([A-Z]+)\.(.+)$/);
    const pluginMatch = key.match(/^plugins\.metrics-by-endpoint\.response_time\.(.+)$/);
    let method: string;
    let endpoint: string;
    if (match) {
      method = match[1];
      endpoint = match[2];
    } else if (pluginMatch) {
      endpoint = pluginMatch[1];
      method = inferMethodForEndpoint(endpoint);
    } else {
      continue;
    }

    const requestsTotal = toNumber(value.count) ?? 0;
    const durationSeconds = Math.max(durationMs / 1000, 1);
    const endpointKey = `${method}|${endpoint}`;
    const responseCodes = endpointCodeBreakdown.get(endpoint) ?? {};
    const successCount = Object.entries(responseCodes)
      .filter(([code]) => code.startsWith("2"))
      .reduce((sum, [, count]) => sum + count, 0);
    const errorCount = Object.entries(responseCodes)
      .filter(([code]) => !code.startsWith("2"))
      .reduce((sum, [, count]) => sum + count, 0);
    const errorRate =
      requestsTotal > 0 ? errorCount / requestsTotal : null;

    endpointMetrics.push({
      method,
      endpoint,
      requestsTotal,
      successCount,
      errorCount,
      errorRate,
      responseCodes,
      minMs: toNumber(value.min),
      maxMs: toNumber(value.max),
      meanMs: toNumber(value.mean),
      p50Ms: toNumber(value.median),
      p95Ms: toNumber(value.p95),
      p99Ms: toNumber(value.p99),
      rps: requestsTotal / durationSeconds,
    });
    seenEndpointKeys.add(endpointKey);
  }

  for (const [endpoint, responseCodes] of endpointCodeBreakdown.entries()) {
    const method = inferMethodForEndpoint(endpoint);
    const endpointKey = `${method}|${endpoint}`;
    if (seenEndpointKeys.has(endpointKey)) {
      continue;
    }

    const requestsTotal = Object.values(responseCodes).reduce((sum, count) => sum + count, 0);
    const successCount = Object.entries(responseCodes)
      .filter(([code]) => code.startsWith("2"))
      .reduce((sum, [, count]) => sum + count, 0);
    const errorCount = Object.entries(responseCodes)
      .filter(([code]) => !code.startsWith("2"))
      .reduce((sum, [, count]) => sum + count, 0);
    const errorRate = requestsTotal > 0 ? errorCount / requestsTotal : null;
    const durationSeconds = Math.max(durationMs / 1000, 1);

    endpointMetrics.push({
      method,
      endpoint,
      requestsTotal,
      successCount,
      errorCount,
      errorRate,
      responseCodes,
      minMs: null,
      maxMs: null,
      meanMs: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      rps: requestsTotal / durationSeconds,
    });
  }

  const requestsFromCounters =
    counters["http.requests"] ??
    counters["vusers.created"] ??
    endpointMetrics.reduce((sum, metric) => sum + metric.requestsTotal, 0);
  const overallRequests = Math.max(0, requestsFromCounters);
  const transportErrors = Object.values(errors).reduce((sum, value) => sum + value, 0);
  const httpStatusErrors = Object.entries(codes)
    .filter(([statusCode]) => !statusCode.startsWith("2"))
    .reduce((sum, [, count]) => sum + count, 0);
  const overallErrors = Math.max(transportErrors, httpStatusErrors);
  const overallErrorRate = overallRequests > 0 ? overallErrors / overallRequests : 0;

  return {
    durationMs,
    overallRequests,
    overallErrors,
    overallErrorRate,
    timeoutCount,
    responseCodes: codes,
    errorBreakdown: errors,
    endpointMetrics,
  };
}

async function runDataChecks(params: {
  runId: string;
  scenario: ScenarioName;
  summary: ArtillerySummary;
}): Promise<
  Array<{
    check_name: string;
    passed: boolean;
    observed_value: number;
    details: Prisma.InputJsonValue;
  }>
> {
  const runSessionId = `lt-${params.runId}`;
  const expectsAssignmentRows = params.scenario === "assignment" || params.scenario === "mixed";
  const expectsEventRows = params.scenario === "events" || params.scenario === "mixed";
  const checks: Array<{
    check_name: string;
    passed: boolean;
    observed_value: number;
    details: Prisma.InputJsonValue;
  }> = [];

  const assignmentDupRows = await prisma.$queryRaw<Array<{ duplicate_rows: number }>>`
    WITH duplicated AS (
      SELECT COUNT(*) AS row_count
      FROM assignments
      GROUP BY anonymous_user_id, experiment_id
      HAVING COUNT(*) > 1
    )
    SELECT COALESCE(SUM(row_count - 1), 0)::INT AS duplicate_rows
    FROM duplicated
  `;
  const assignmentDuplicateRows = assignmentDupRows[0]?.duplicate_rows ?? 0;
  checks.push({
    check_name: "assignment_duplicate_rows_global",
    passed: assignmentDuplicateRows === 0,
    observed_value: assignmentDuplicateRows,
    details: { expected: 0 },
  });

  const eventDupRows = await prisma.$queryRaw<Array<{ duplicate_rows: number }>>`
    WITH duplicated AS (
      SELECT COUNT(*) AS row_count
      FROM event_logs
      WHERE event_id IS NOT NULL
      GROUP BY event_id
      HAVING COUNT(*) > 1
    )
    SELECT COALESCE(SUM(row_count - 1), 0)::INT AS duplicate_rows
    FROM duplicated
  `;
  const eventDuplicateRows = eventDupRows[0]?.duplicate_rows ?? 0;
  checks.push({
    check_name: "event_id_duplicate_rows_global",
    passed: eventDuplicateRows === 0,
    observed_value: eventDuplicateRows,
    details: { expected: 0 },
  });

  const scopedAssignmentRows = await prisma.$queryRaw<Array<{ scoped_rows: number }>>`
    SELECT COUNT(*)::INT AS scoped_rows
    FROM assignments
    WHERE context->>'session_id' = ${runSessionId}
  `;
  const scopedAssignmentCount = scopedAssignmentRows[0]?.scoped_rows ?? 0;
  checks.push({
    check_name: "load_test_assignment_rows_scoped",
    passed: expectsAssignmentRows ? scopedAssignmentCount > 0 : scopedAssignmentCount === 0,
    observed_value: scopedAssignmentCount,
    details: expectsAssignmentRows
      ? { expected_min: 1, session_id: runSessionId }
      : { expected_exact: 0, session_id: runSessionId },
  });

  const scopedEventRows = await prisma.$queryRaw<Array<{ scoped_rows: number }>>`
    SELECT COUNT(*)::INT AS scoped_rows
    FROM event_logs
    WHERE properties->>'load_test_run_id' = ${params.runId}
  `;
  const scopedEventCount = scopedEventRows[0]?.scoped_rows ?? 0;
  checks.push({
    check_name: "load_test_event_rows_scoped",
    passed: expectsEventRows ? scopedEventCount > 0 : scopedEventCount === 0,
    observed_value: scopedEventCount,
    details: expectsEventRows
      ? { expected_min: 1, run_id: params.runId }
      : { expected_exact: 0, run_id: params.runId },
  });

  const stickyConflictRows = await prisma.$queryRaw<Array<{ conflict_groups: number }>>`
    WITH scoped AS (
      SELECT anonymous_user_id, experiment_id, COUNT(DISTINCT variant_id) AS variant_count
      FROM assignments
      WHERE context->>'session_id' = ${runSessionId}
      GROUP BY anonymous_user_id, experiment_id
    )
    SELECT COUNT(*)::INT AS conflict_groups
    FROM scoped
    WHERE variant_count > 1
  `;
  const stickyConflicts = stickyConflictRows[0]?.conflict_groups ?? 0;
  checks.push({
    check_name: "sticky_assignment_conflicts_scoped",
    passed: stickyConflicts === 0,
    observed_value: stickyConflicts,
    details: { expected: 0, session_id: runSessionId },
  });

  const rollupOverlapRows = await prisma.$queryRaw<Array<{ overlap_count: number }>>`
    SELECT COUNT(*)::INT AS overlap_count
    FROM rollup_runs
    WHERE started_at >= NOW() - INTERVAL '2 hours'
      AND status = 'RUNNING'
  `;
  const rollupOverlaps = rollupOverlapRows[0]?.overlap_count ?? 0;
  checks.push({
    check_name: "rollup_overlap_running",
    passed: rollupOverlaps === 0,
    observed_value: rollupOverlaps,
    details: { expected: 0 },
  });

  checks.push({
    check_name: "http_error_rate_under_1pct",
    passed: params.summary.overallErrorRate <= 0.01,
    observed_value: params.summary.overallErrorRate,
    details: { threshold: 0.01 },
  });

  return checks;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const artifactsDir = path.join(root, "artifacts", "load-tests");
  await fs.mkdir(artifactsDir, { recursive: true });

  const runningRollups = await prisma.rollupRun.count({
    where: {
      status: "RUNNING",
    },
  });
  if (runningRollups > 0) {
    throw new Error(
      `Cannot start load test while ${runningRollups} rollup job(s) are RUNNING. Retry after rollups finish.`,
    );
  }

  const gitSha = getGitSha(root);
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  const loadTestRun = await prisma.loadTestRun.create({
    data: {
      run_name: args.runName,
      scenario_name: args.scenario,
      phase: args.phase,
      status: LoadTestRunStatus.RUNNING,
      target_base_url: args.target,
      git_sha: gitSha,
      started_at: startedAt,
      notes: args.notes ?? null,
      tags: {
        ...args.tags,
        run_name: args.runName,
        phase: args.phase,
        scenario: args.scenario,
        started_at: startedAtIso,
      } as Prisma.InputJsonValue,
    },
  });

  try {
    const result = await runArtillery({
      root,
      scenario: args.scenario,
      runId: loadTestRun.id,
      phase: args.phase,
      target: args.target,
      startedAtIso,
      artifactsDir,
    });

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();

    const reportRaw = await fs.readFile(result.outputPath, "utf8");
    const reportJson = JSON.parse(reportRaw) as Record<string, unknown>;
    const summary = parseArtillerySummary(reportJson, durationMs);

    if (summary.endpointMetrics.length > 0) {
      await prisma.loadTestEndpointMetric.createMany({
        data: summary.endpointMetrics.map((metric) => ({
          run_id: loadTestRun.id,
          endpoint: metric.endpoint,
          method: metric.method,
          requests_total: metric.requestsTotal,
          success_count: metric.successCount,
          error_count: metric.errorCount,
          timeout_count: summary.timeoutCount,
          error_rate: metric.errorRate,
          min_ms: metric.minMs,
          max_ms: metric.maxMs,
          mean_ms: metric.meanMs,
          p50_ms: metric.p50Ms,
          p95_ms: metric.p95Ms,
          p99_ms: metric.p99Ms,
          rps: metric.rps,
          response_codes: metric.responseCodes as Prisma.InputJsonValue,
          error_breakdown: summary.errorBreakdown as Prisma.InputJsonValue,
        })),
      });
    }

    const checks = await runDataChecks({ runId: loadTestRun.id, scenario: args.scenario, summary });
    if (checks.length > 0) {
      await prisma.loadTestDataCheck.createMany({
        data: checks.map((check) => ({
          run_id: loadTestRun.id,
          check_name: check.check_name,
          passed: check.passed,
          observed_value: check.observed_value,
          details: check.details,
        })),
      });
    }

    await prisma.loadTestRun.update({
      where: { id: loadTestRun.id },
      data: {
        status: LoadTestRunStatus.SUCCESS,
        ended_at: endedAt,
        duration_ms: durationMs,
        artifacts_path: path.relative(root, result.outputPath),
        tags: {
          ...args.tags,
          run_name: args.runName,
          phase: args.phase,
          scenario: args.scenario,
          started_at: startedAtIso,
          ended_at: endedAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          run_id: loadTestRun.id,
          run_name: args.runName,
          phase: args.phase,
          scenario: args.scenario,
          target: args.target,
          started_at: startedAtIso,
          ended_at: endedAt.toISOString(),
          duration_ms: durationMs,
          artifacts_path: path.relative(root, result.outputPath),
          overall_requests: summary.overallRequests,
          overall_errors: summary.overallErrors,
          overall_error_rate: summary.overallErrorRate,
          timeout_count: summary.timeoutCount,
          endpoint_metrics_count: summary.endpointMetrics.length,
          checks_recorded: checks.length,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const endedAt = new Date();
    await prisma.loadTestRun.update({
      where: { id: loadTestRun.id },
      data: {
        status: LoadTestRunStatus.FAILED,
        ended_at: endedAt,
        duration_ms: endedAt.getTime() - startedAt.getTime(),
        error_text: error instanceof Error ? error.message : String(error),
        tags: {
          ...args.tags,
          run_name: args.runName,
          phase: args.phase,
          scenario: args.scenario,
          started_at: startedAtIso,
          ended_at: endedAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    throw error;
  }
}

main()
  .catch((error) => {
    console.error("loadtest:run failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
