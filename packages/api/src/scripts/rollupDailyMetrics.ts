import "dotenv/config";
import { computeAndStoreMetricsSummary } from "../services/metricsService";

async function main(): Promise<void> {
  const summary = await computeAndStoreMetricsSummary();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("Metrics rollup failed:", error);
  process.exitCode = 1;
});
