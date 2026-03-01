import { Prisma } from "@prisma/client";
import prisma from "../db/prisma";
import { deepMerge, toJsonObject, type JsonObject } from "../utils/deepMerge";
import { matchesTargeting } from "../utils/targeting";
import { selectWeightedVariant } from "../utils/weightedBucket";

export type AssignmentRequestContext = {
  anonymous_user_id: string;
  session_id?: string;
  platform?: "ios" | "android";
  app_version?: string;
  install_id?: string;
};

export type AssignmentResponsePayload = {
  assignment_version: number;
  assignments: Array<{
    experiment_id: string;
    variant_id: string;
    variant_name: string;
  }>;
  config: JsonObject;
};

type ExperimentWithVariants = Prisma.ExperimentGetPayload<{
  include: { variants: true };
}>;
type AssignmentRecord = Prisma.AssignmentGetPayload<{}>;

const ASSIGNMENT_VERSION = 1;

const BASELINE_CONFIG: JsonObject = {
  navigation: {
    default_landing_tab: "workouts",
  },
  workouts: {
    preload_default_plan: false,
  },
  creatures: {
    recommended_creature_id: null,
  },
  achievements: {
    ui_mode: "baseline",
  },
};

function buildAssignmentContextJson(
  context: AssignmentRequestContext,
): Prisma.InputJsonValue {
  return {
    session_id: context.session_id ?? null,
    platform: context.platform ?? null,
    app_version: context.app_version ?? null,
    install_id: context.install_id ?? null,
  };
}

function chooseWeightedVariant(
  anonymousUserId: string,
  experiment: ExperimentWithVariants,
): ExperimentWithVariants["variants"][number] {
  return selectWeightedVariant(
    `${anonymousUserId}:${experiment.experiment_id}`,
    experiment.variants.map((variant) => ({
      ...variant,
      weight: variant.weight,
    })),
  );
}

function mapByExperimentId<T extends { experiment_id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.experiment_id, item]));
}

function variantMap(
  variants: ExperimentWithVariants["variants"],
): Map<string, ExperimentWithVariants["variants"][number]> {
  return new Map(variants.map((variant) => [variant.variant_id, variant]));
}

async function getActiveExperiments(now: Date): Promise<ExperimentWithVariants[]> {
  return prisma.experiment.findMany({
    where: {
      status: "RUNNING",
      AND: [
        {
          OR: [{ start_at: null }, { start_at: { lte: now } }],
        },
        {
          OR: [{ end_at: null }, { end_at: { gte: now } }],
        },
      ],
    },
    include: {
      variants: true,
    },
  });
}

async function resolveVariantForExperiment(params: {
  experiment: ExperimentWithVariants;
  context: AssignmentRequestContext;
  existingAssignment?: AssignmentRecord;
}): Promise<ExperimentWithVariants["variants"][number]> {
  const { experiment, context, existingAssignment } = params;
  const variantsById = variantMap(experiment.variants);
  const existingVariant = existingAssignment
    ? variantsById.get(existingAssignment.variant_id)
    : undefined;

  if (existingVariant) {
    return existingVariant;
  }

  const selectedVariant = chooseWeightedVariant(context.anonymous_user_id, experiment);
  const assignmentContext = buildAssignmentContextJson(context);

  const persisted = await prisma.assignment.upsert({
    where: {
      assignment_user_experiment_unique: {
        anonymous_user_id: context.anonymous_user_id,
        experiment_id: experiment.experiment_id,
      },
    },
    create: {
      anonymous_user_id: context.anonymous_user_id,
      experiment_id: experiment.experiment_id,
      variant_id: selectedVariant.variant_id,
      assignment_version: ASSIGNMENT_VERSION,
      context: assignmentContext,
    },
    // Keep first persisted assignment sticky; avoid extra write churn on races.
    update: {},
  });

  return variantsById.get(persisted.variant_id) ?? selectedVariant;
}

export async function getAssignmentPayload(
  context: AssignmentRequestContext,
): Promise<AssignmentResponsePayload> {
  const now = new Date();
  const activeExperiments = await getActiveExperiments(now);
  const eligibleExperiments = activeExperiments
    .filter((experiment) =>
      matchesTargeting(experiment.targeting, {
        platform: context.platform,
        app_version: context.app_version,
      }),
    )
    .filter((experiment) => experiment.variants.length > 0)
    .sort((a, b) => a.experiment_id.localeCompare(b.experiment_id));

  if (eligibleExperiments.length === 0) {
    return {
      assignment_version: ASSIGNMENT_VERSION,
      assignments: [],
      config: deepMerge({}, BASELINE_CONFIG),
    };
  }

  const existingAssignments = await prisma.assignment.findMany({
    where: {
      anonymous_user_id: context.anonymous_user_id,
      experiment_id: {
        in: eligibleExperiments.map((experiment) => experiment.experiment_id),
      },
    },
  });

  const assignmentByExperimentId = mapByExperimentId(existingAssignments);
  // Resolve eligible experiments concurrently; apply config merge in deterministic order.
  const resolvedExperiments = await Promise.all(
    eligibleExperiments.map(async (experiment) => {
      const selectedVariant = await resolveVariantForExperiment({
        experiment,
        context,
        existingAssignment: assignmentByExperimentId.get(experiment.experiment_id),
      });
      return { experiment, selectedVariant };
    }),
  );

  const assignments: AssignmentResponsePayload["assignments"] = [];
  let mergedConfig = deepMerge({}, BASELINE_CONFIG);

  for (const resolved of resolvedExperiments) {
    assignments.push({
      experiment_id: resolved.experiment.experiment_id,
      variant_id: resolved.selectedVariant.variant_id,
      variant_name: resolved.selectedVariant.variant_name,
    });

    mergedConfig = deepMerge(mergedConfig, toJsonObject(resolved.selectedVariant.config));
  }

  return {
    assignment_version: ASSIGNMENT_VERSION,
    assignments,
    config: mergedConfig,
  };
}
