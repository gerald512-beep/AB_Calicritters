import prisma from "../db/prisma";

export interface EventAssignmentContext {
  assignment_version: number | null;
  assignments: Array<{
    experiment_id: string;
    variant_id: string;
    variant_name: string;
  }>;
  experiment_map: Record<string, string>;
}

export async function getEventAssignmentContext(
  anonymousUserId: string,
): Promise<EventAssignmentContext> {
  const assignmentRows = await prisma.assignment.findMany({
    where: {
      anonymous_user_id: anonymousUserId,
      experiment: {
        status: "RUNNING",
      },
    },
    orderBy: {
      experiment_id: "asc",
    },
  });

  if (assignmentRows.length === 0) {
    return {
      assignment_version: null,
      assignments: [],
      experiment_map: {},
    };
  }

  const experimentIds = Array.from(new Set(assignmentRows.map((assignment) => assignment.experiment_id)));
  const variantRows = await prisma.experimentVariant.findMany({
    where: {
      experiment_id: {
        in: experimentIds,
      },
    },
  });

  const variantNameMap = new Map(
    variantRows.map((variant) => [`${variant.experiment_id}:${variant.variant_id}`, variant.variant_name]),
  );

  const assignments = assignmentRows.map((assignment) => ({
    experiment_id: assignment.experiment_id,
    variant_id: assignment.variant_id,
    variant_name:
      variantNameMap.get(`${assignment.experiment_id}:${assignment.variant_id}`) ??
      assignment.variant_id,
  }));

  const experimentMap = assignments.reduce<Record<string, string>>((acc, assignment) => {
    acc[assignment.experiment_id] = assignment.variant_id;
    return acc;
  }, {});

  const assignmentVersion = assignmentRows.reduce(
    (maxValue, assignment) => Math.max(maxValue, assignment.assignment_version),
    1,
  );

  return {
    assignment_version: assignmentVersion,
    assignments,
    experiment_map: experimentMap,
  };
}
