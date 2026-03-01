import { createHash } from "crypto";
import { z } from "zod";

const EVENT_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const MAX_EVENT_NAME_LENGTH = 80;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_EVENTS_PER_BATCH = 100;

const jsonObjectSchema = z.object({}).catchall(z.unknown());

const batchEnvelopeSchema = z.object({
  anonymous_user_id: z.string().trim().min(1, "anonymous_user_id is required"),
  session_id: z.string().optional(),
  install_id: z.string().optional(),
  platform: z.enum(["ios", "android"]).optional(),
  app_version: z.string().optional(),
  sent_at: z.string().optional(),
  events: z
    .array(z.unknown())
    .min(1, "events must be a non-empty array")
    .max(MAX_EVENTS_PER_BATCH, `events must contain at most ${MAX_EVENTS_PER_BATCH} items`),
});

const eventSchema = z.object({
  event_id: z.string().uuid("event_id must be a valid uuid").optional(),
  event_name: z
    .string()
    .min(1, "event_name is required")
    .max(MAX_EVENT_NAME_LENGTH, `event_name must be <= ${MAX_EVENT_NAME_LENGTH} chars`)
    .regex(EVENT_NAME_PATTERN, "event_name has invalid characters"),
  occurred_at: z.string().min(1, "occurred_at is required"),
  properties: jsonObjectSchema.optional(),
  context: jsonObjectSchema.optional(),
});

export interface ParsedEventBatch {
  anonymous_user_id: string;
  session_id?: string;
  install_id?: string;
  platform?: "ios" | "android";
  app_version?: string;
  sent_at?: Date;
  acceptedEvents: NormalizedEvent[];
  results: EventResult[];
  accepted: number;
  rejected: number;
}

export interface NormalizedEvent {
  index: number;
  event_id: string;
  event_name: string;
  occurred_at: Date;
  properties?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export type EventResult =
  | {
      index: number;
      status: "accepted";
      event_id: string;
    }
  | {
      index: number;
      status: "rejected";
      error: string;
    };

export class EventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventValidationError";
  }
}

function parseIsoDate(dateValue: string): Date | null {
  const parsedDate = new Date(dateValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function formatUuidFromBytes(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function deterministicEventId(seed: string): string {
  const digest = createHash("sha256").update(seed).digest().subarray(0, 16);
  // UUIDv5-compatible bit layout from deterministic hash bytes.
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return formatUuidFromBytes(digest);
}

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid request body";
  }
  return issue.message;
}

export function parseEventBatchRequest(
  payload: unknown,
  now: Date = new Date(),
): ParsedEventBatch {
  const envelope = batchEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new EventValidationError(firstIssueMessage(envelope.error));
  }

  const parsedSentAt = envelope.data.sent_at ? parseIsoDate(envelope.data.sent_at) : null;
  if (envelope.data.sent_at && !parsedSentAt) {
    throw new EventValidationError("sent_at must be an ISO datetime string");
  }

  const acceptedEvents: NormalizedEvent[] = [];
  const results: EventResult[] = [];

  envelope.data.events.forEach((eventInput, index) => {
    const parsedEvent = eventSchema.safeParse(eventInput);
    if (!parsedEvent.success) {
      results.push({
        index,
        status: "rejected",
        error: firstIssueMessage(parsedEvent.error),
      });
      return;
    }

    const occurredAt = parseIsoDate(parsedEvent.data.occurred_at);
    if (!occurredAt) {
      results.push({
        index,
        status: "rejected",
        error: "occurred_at must be an ISO datetime string",
      });
      return;
    }

    if (occurredAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
      results.push({
        index,
        status: "rejected",
        error: "occurred_at is too far in the future",
      });
      return;
    }

    const eventId =
      parsedEvent.data.event_id ??
      deterministicEventId(
        [
          envelope.data.anonymous_user_id.trim(),
          envelope.data.session_id ?? "",
          envelope.data.install_id ?? "",
          envelope.data.sent_at ?? "",
          String(index),
          parsedEvent.data.event_name,
          parsedEvent.data.occurred_at,
        ].join("|"),
      );
    acceptedEvents.push({
      index,
      event_id: eventId,
      event_name: parsedEvent.data.event_name,
      occurred_at: occurredAt,
      properties: parsedEvent.data.properties,
      context: parsedEvent.data.context,
    });
    results.push({
      index,
      status: "accepted",
      event_id: eventId,
    });
  });

  return {
    anonymous_user_id: envelope.data.anonymous_user_id.trim(),
    session_id: envelope.data.session_id,
    install_id: envelope.data.install_id,
    platform: envelope.data.platform,
    app_version: envelope.data.app_version,
    sent_at: parsedSentAt ?? undefined,
    acceptedEvents,
    results,
    accepted: acceptedEvents.length,
    rejected: results.length - acceptedEvents.length,
  };
}
