import { Prisma } from "@prisma/client";
import prisma from "../db/prisma";
import { addDays, enumerateDays, toIsoDay } from "../utils/time";
import { countIgnoredEvents, getValidityBounds, type JobResult, type RollupWindow } from "./common";

type FunnelCountRow = {
  users_count: number;
  events_count: number;
};

type FunnelVariantRow = {
  experiment_id: string;
  variant_id: string;
  users_count: number;
  events_count: number;
};

const CORE_FUNNEL_NAME = "core_journey";

const FUNNEL_STEPS: Array<{ stepName: string; eventNames: string[] }> = [
  { stepName: "active_open", eventNames: ["app_opened", "tab_opened"] },
  { stepName: "workout_engaged", eventNames: ["workouts_default_loaded", "workout_started"] },
  { stepName: "exercise_logged", eventNames: ["exercise_logged"] },
  { stepName: "session_submitted", eventNames: ["session_submitted"] },
  { stepName: "achievement_unlocked", eventNames: ["achievement_unlocked"] },
];

export async function runFunnelRollup(window: RollupWindow): Promise<JobResult> {
  const { futureBound, oldestAllowed } = getValidityBounds(window.now);
  const ignoredCount = await countIgnoredEvents(window);
  const days = enumerateDays(window.windowStart, window.windowEnd);
  let rowsWritten = 0;

  for (const dayStart of days) {
    const dayEnd = addDays(dayStart, 1);

    for (const step of FUNNEL_STEPS) {
      const eventNameLiterals = Prisma.join(step.eventNames.map((name) => Prisma.sql`${name}`));

      const overallRows = await prisma.$queryRaw<FunnelCountRow[]>(Prisma.sql`
        SELECT
          COUNT(DISTINCT anonymous_user_id)::INT AS users_count,
          COUNT(*)::INT AS events_count
        FROM event_logs
        WHERE occurred_at >= ${dayStart}
          AND occurred_at < ${dayEnd}
          AND occurred_at <= ${futureBound}
          AND occurred_at >= ${oldestAllowed}
          AND event_name IN (${eventNameLiterals})
      `);
      const overall = overallRows[0] ?? { users_count: 0, events_count: 0 };

      const variantRows = await prisma.$queryRaw<FunnelVariantRow[]>(Prisma.sql`
        SELECT
          kv.key AS experiment_id,
          kv.value AS variant_id,
          COUNT(DISTINCT e.anonymous_user_id)::INT AS users_count,
          COUNT(*)::INT AS events_count
        FROM event_logs e
        CROSS JOIN LATERAL jsonb_each_text(e.experiment_map) kv
        WHERE e.occurred_at >= ${dayStart}
          AND e.occurred_at < ${dayEnd}
          AND e.occurred_at <= ${futureBound}
          AND e.occurred_at >= ${oldestAllowed}
          AND e.event_name IN (${eventNameLiterals})
        GROUP BY kv.key, kv.value
      `);

      await prisma.$transaction(async (tx) => {
        await tx.funnelRollup.deleteMany({
          where: {
            day: dayStart,
            funnel_name: CORE_FUNNEL_NAME,
            step_name: step.stepName,
          },
        });

        const records = [
          {
            day: dayStart,
            funnel_name: CORE_FUNNEL_NAME,
            step_name: step.stepName,
            dimension_key: "overall",
            experiment_id: null,
            variant_id: null,
            users_count: overall.users_count,
            events_count: overall.events_count,
          },
          ...variantRows.map((variantRow) => ({
            day: dayStart,
            funnel_name: CORE_FUNNEL_NAME,
            step_name: step.stepName,
            dimension_key: `${variantRow.experiment_id}:${variantRow.variant_id}`,
            experiment_id: variantRow.experiment_id,
            variant_id: variantRow.variant_id,
            users_count: variantRow.users_count,
            events_count: variantRow.events_count,
          })),
        ];

        await tx.funnelRollup.createMany({
          data: records,
        });

        rowsWritten += records.length;
      });
    }
  }

  return {
    rowsWritten,
    ignoredCount,
  };
}

export const FUNNEL_NAME = CORE_FUNNEL_NAME;
