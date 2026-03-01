import "dotenv/config";
import { LoadTestPhase, LoadTestRunStatus } from "@prisma/client";
import prisma from "../db/prisma";

type Args = {
  runId?: string;
  scenario?: string;
  phase?: LoadTestPhase;
  maxErrorRate: number;
};

function parsePhase(raw: string | undefined): LoadTestPhase | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "baseline") {
    return LoadTestPhase.BASELINE;
  }
  if (normalized === "post_mitigation" || normalized === "post-mitigation") {
    return LoadTestPhase.POST_MITIGATION;
  }
  throw new Error("Invalid --phase. Use baseline or post_mitigation.");
}

function parseArgs(argv: string[]): Args {
  let runId: string | undefined;
  let scenario: string | undefined;
  let phase: LoadTestPhase | undefined;
  let maxErrorRate = 0.01;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--run-id" && argv[i + 1]) {
      runId = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--scenario" && argv[i + 1]) {
      scenario = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--phase" && argv[i + 1]) {
      phase = parsePhase(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--max-error-rate" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        throw new Error("Invalid --max-error-rate. Use a number between 0 and 1.");
      }
      maxErrorRate = parsed;
      i += 1;
      continue;
    }
  }

  return {
    runId,
    scenario,
    phase,
    maxErrorRate,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const run = args.runId
    ? await prisma.loadTestRun.findUnique({
        where: { id: args.runId },
        include: {
          endpoint_metrics: true,
          data_checks: true,
        },
      })
    : await prisma.loadTestRun.findFirst({
        where: {
          ...(args.scenario ? { scenario_name: args.scenario } : {}),
          ...(args.phase ? { phase: args.phase } : {}),
        },
        include: {
          endpoint_metrics: true,
          data_checks: true,
        },
        orderBy: { started_at: "desc" },
      });

  if (!run) {
    throw new Error("No matching load-test run found.");
  }

  const failures: string[] = [];

  if (run.status !== LoadTestRunStatus.SUCCESS) {
    failures.push(`Run status is ${run.status}, expected SUCCESS.`);
  }

  for (const check of run.data_checks) {
    if (!check.passed) {
      failures.push(
        `Data check failed: ${check.check_name} observed_value=${check.observed_value ?? "null"}`,
      );
    }
  }

  for (const metric of run.endpoint_metrics) {
    if (metric.error_rate !== null && metric.error_rate > args.maxErrorRate) {
      failures.push(
        `Endpoint error rate exceeded: ${metric.method} ${metric.endpoint} error_rate=${metric.error_rate} threshold=${args.maxErrorRate}`,
      );
    }
  }

  const result = {
    ok: failures.length === 0,
    run: {
      id: run.id,
      run_name: run.run_name,
      scenario_name: run.scenario_name,
      phase: run.phase,
      status: run.status,
      started_at: run.started_at.toISOString(),
      ended_at: run.ended_at ? run.ended_at.toISOString() : null,
      duration_ms: run.duration_ms,
    },
    gate: {
      max_error_rate: args.maxErrorRate,
      checks_total: run.data_checks.length,
      endpoints_total: run.endpoint_metrics.length,
    },
    failures,
  };

  console.log(JSON.stringify(result, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("loadtest:assert failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
