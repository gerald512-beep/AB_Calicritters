import "dotenv/config";
import prisma from "./db/prisma";
import { runRollups, type JobName } from "./rollups";

const DEFAULT_WINDOW_DAYS = 14;

function parseArgs(argv: string[]): { windowDays: number; selectedJobs: JobName[] } {
  let windowDays = DEFAULT_WINDOW_DAYS;
  let jobArg: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--window-days" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 180) {
        windowDays = parsed;
      }
      i += 1;
      continue;
    }

    if (token === "--job" && argv[i + 1]) {
      jobArg = argv[i + 1];
      i += 1;
    }
  }

  const selectedJobs: JobName[] =
    jobArg === "daily"
      ? ["daily"]
      : jobArg === "experiment"
        ? ["experiment"]
        : jobArg === "funnel"
          ? ["funnel"]
          : ["daily", "experiment", "funnel"];

  return {
    windowDays,
    selectedJobs,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const summary = await runRollups(args);
  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
}

main()
  .catch((error) => {
    console.error("jobs:rollup failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
