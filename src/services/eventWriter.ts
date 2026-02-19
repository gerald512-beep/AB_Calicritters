import { Prisma } from "@prisma/client";
import prisma from "../db/prisma";
import type { EventAssignmentContext } from "./enrichmentService";
import type { NormalizedEvent } from "./eventValidation";

export interface EventBatchMetadata {
  anonymous_user_id: string;
  session_id?: string;
  install_id?: string;
  platform?: "ios" | "android";
  app_version?: string;
  sent_at?: Date;
}

export async function writeEventBatch(params: {
  metadata: EventBatchMetadata;
  events: NormalizedEvent[];
  enrichment: EventAssignmentContext;
}): Promise<{ inserted_count: number }> {
  const { metadata, events, enrichment } = params;

  if (events.length === 0) {
    return { inserted_count: 0 };
  }

  const assignmentJson =
    enrichment.assignments.length > 0
      ? (enrichment.assignments as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  const experimentMapJson =
    Object.keys(enrichment.experiment_map).length > 0
      ? (enrichment.experiment_map as Prisma.InputJsonValue)
      : Prisma.JsonNull;

  const insertRows = events.map((event) => ({
    event_id: event.event_id,
    anonymous_user_id: metadata.anonymous_user_id,
    session_id: metadata.session_id ?? null,
    install_id: metadata.install_id ?? null,
    platform: metadata.platform ?? null,
    app_version: metadata.app_version ?? null,
    event_name: event.event_name,
    occurred_at: event.occurred_at,
    sent_at: metadata.sent_at ?? null,
    properties: event.properties ? (event.properties as Prisma.InputJsonValue) : Prisma.JsonNull,
    context: event.context ? (event.context as Prisma.InputJsonValue) : Prisma.JsonNull,
    assignment_version: enrichment.assignment_version,
    assignments: assignmentJson,
    experiment_map: experimentMapJson,
    schema_version: 1,
  }));

  const result = await prisma.eventLog.createMany({
    data: insertRows,
    skipDuplicates: true,
  });

  return { inserted_count: result.count };
}
