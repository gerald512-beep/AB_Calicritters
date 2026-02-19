import { getEventAssignmentContext } from "./enrichmentService";
import { writeEventBatch } from "./eventWriter";
import { parseEventBatchRequest } from "./eventValidation";

export type EventIngestionResult = {
  ok: true;
  received_at: string;
  accepted: number;
  rejected: number;
  results: ReturnType<typeof parseEventBatchRequest>["results"];
  inserted: number;
};

export async function ingestEventBatch(body: unknown): Promise<EventIngestionResult> {
  const parsedBatch = parseEventBatchRequest(body);

  const enrichmentContext = await getEventAssignmentContext(parsedBatch.anonymous_user_id);
  const writeResult = await writeEventBatch({
    metadata: {
      anonymous_user_id: parsedBatch.anonymous_user_id,
      session_id: parsedBatch.session_id,
      install_id: parsedBatch.install_id,
      platform: parsedBatch.platform,
      app_version: parsedBatch.app_version,
      sent_at: parsedBatch.sent_at,
    },
    events: parsedBatch.acceptedEvents,
    enrichment: enrichmentContext,
  });

  return {
    ok: true,
    received_at: new Date().toISOString(),
    accepted: parsedBatch.accepted,
    rejected: parsedBatch.rejected,
    results: parsedBatch.results,
    inserted: writeResult.inserted_count,
  };
}

export { EventValidationError } from "./eventValidation";
