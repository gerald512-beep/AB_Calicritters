import { ExperimentStatus, Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BASELINE_CONFIG = {
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

type SeedVariant = {
  variant_id: string;
  variant_name: string;
  is_control: boolean;
  weight: number;
  config: Prisma.InputJsonValue;
};

async function seedExperiment(
  experimentId: string,
  variants: SeedVariant[],
): Promise<void> {
  await prisma.experiment.upsert({
    where: { experiment_id: experimentId },
    update: {
      status: ExperimentStatus.RUNNING,
      start_at: null,
      end_at: null,
      targeting: null,
      config_schema_version: 1,
    },
    create: {
      experiment_id: experimentId,
      status: ExperimentStatus.RUNNING,
      start_at: null,
      end_at: null,
      targeting: null,
      config_schema_version: 1,
    },
  });

  for (const variant of variants) {
    await prisma.experimentVariant.upsert({
      where: {
        experiment_variant_unique: {
          experiment_id: experimentId,
          variant_id: variant.variant_id,
        },
      },
      update: {
        variant_name: variant.variant_name,
        is_control: variant.is_control,
        weight: variant.weight,
        config: variant.config,
      },
      create: {
        experiment_id: experimentId,
        variant_id: variant.variant_id,
        variant_name: variant.variant_name,
        is_control: variant.is_control,
        weight: variant.weight,
        config: variant.config,
      },
    });
  }

  await prisma.experimentVariant.deleteMany({
    where: {
      experiment_id: experimentId,
      variant_id: { notIn: variants.map((variant) => variant.variant_id) },
    },
  });
}

async function main(): Promise<void> {
  await seedExperiment("exp_3_landing_journey", [
    {
      variant_id: "A",
      variant_name: "workouts_preloaded",
      is_control: true,
      weight: 0.34,
      config: {
        navigation: { default_landing_tab: "workouts" },
        workouts: { preload_default_plan: true },
      },
    },
    {
      variant_id: "B",
      variant_name: "workouts_starter",
      is_control: false,
      weight: 0.33,
      config: {
        navigation: { default_landing_tab: "workouts" },
        workouts: {
          preload_default_plan: true,
          starter_plan: true,
        },
      },
    },
    {
      variant_id: "C",
      variant_name: "creatures_recommended",
      is_control: false,
      weight: 0.33,
      config: {
        navigation: { default_landing_tab: "creatures" },
        creatures: { recommended_creature_id: "frog" },
        workouts: { preload_default_plan: false },
      },
    },
  ]);

  await seedExperiment("exp_4_achievements_density", [
    {
      variant_id: "A",
      variant_name: "baseline",
      is_control: true,
      weight: 0.5,
      config: {
        achievements: { ui_mode: "baseline" },
      },
    },
    {
      variant_id: "B",
      variant_name: "minimal_achievements",
      is_control: false,
      weight: 0.5,
      config: {
        achievements: { ui_mode: "minimal" },
      },
    },
  ]);

  console.log("Seed complete. Baseline config:", JSON.stringify(BASELINE_CONFIG));
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
