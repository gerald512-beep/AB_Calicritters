import { getBucketFromAnonymousId } from "./hash";

interface VariantDefinition {
  variant_id: string;
  variant_name: string;
}

interface ExperimentDefinition {
  experiment_id: string;
  variants: VariantDefinition[];
  allocation: Record<string, number>;
  exposure_event_name: "experiment_exposed";
  exposure_point: string;
}

export interface AssignedExperiment {
  experiment_id: string;
  variant_id: string;
  variant_name: string;
  allocation: Record<string, number>;
  exposure_event_name: "experiment_exposed";
  exposure_point: string;
}

export interface ClientConfig {
  default_landing_tab: "workouts" | "creatures";
  preload_workout_plan: boolean;
  recommended_creature_id: string | null;
  achievement_ui_mode: "baseline" | "minimal";
}

const experiments: ExperimentDefinition[] = [
  {
    experiment_id: "exp_3_landing_journey",
    variants: [
      { variant_id: "A", variant_name: "workouts_preloaded" },
      { variant_id: "B", variant_name: "workouts_starter" },
      { variant_id: "C", variant_name: "creatures_recommended" },
    ],
    allocation: { A: 0.34, B: 0.33, C: 0.33 },
    exposure_event_name: "experiment_exposed",
    exposure_point: "landing_screen_rendered",
  },
  {
    experiment_id: "exp_4_achievements_density",
    variants: [
      { variant_id: "A", variant_name: "baseline" },
      { variant_id: "B", variant_name: "minimal_achievements" },
    ],
    allocation: { A: 0.5, B: 0.5 },
    exposure_event_name: "experiment_exposed",
    exposure_point: "any_achievement_surface_rendered",
  },
];

export function buildAssignmentResponse(anonymousUserId: string): {
  experiments: AssignedExperiment[];
  client_config: ClientConfig;
} {
  const assignedExperiments: AssignedExperiment[] = experiments.map((experiment) => {
    const bucket = getBucketFromAnonymousId(anonymousUserId, experiment.variants.length);
    const selected = experiment.variants[bucket];

    return {
      experiment_id: experiment.experiment_id,
      variant_id: selected.variant_id,
      variant_name: selected.variant_name,
      allocation: experiment.allocation,
      exposure_event_name: experiment.exposure_event_name,
      exposure_point: experiment.exposure_point,
    };
  });

  const landingExperiment = assignedExperiments.find(
    (exp) => exp.experiment_id === "exp_3_landing_journey",
  );
  const achievementsExperiment = assignedExperiments.find(
    (exp) => exp.experiment_id === "exp_4_achievements_density",
  );

  const clientConfig: ClientConfig = {
    default_landing_tab: "workouts",
    preload_workout_plan: true,
    recommended_creature_id: null,
    achievement_ui_mode: "baseline",
  };

  if (landingExperiment?.variant_id === "C") {
    clientConfig.default_landing_tab = "creatures";
    clientConfig.preload_workout_plan = false;
    clientConfig.recommended_creature_id = "frog";
  }

  if (achievementsExperiment?.variant_id === "B") {
    clientConfig.achievement_ui_mode = "minimal";
  }

  return { experiments: assignedExperiments, client_config: clientConfig };
}
