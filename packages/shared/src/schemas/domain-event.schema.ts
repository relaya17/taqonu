import { z } from "zod";
import { DOMAIN_EVENT_TYPES } from "../constants/events.js";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const domainEventTypeSchema = z.enum(DOMAIN_EVENT_TYPES);

export const domainEventSchema = z.object({
  id: uuidSchema,
  type: domainEventTypeSchema,
  occurredAt: isoDateTimeSchema,
  ownerId: uuidSchema,
  projectId: uuidSchema.nullable(),
  correlationId: uuidSchema,
  causationId: uuidSchema.nullable(),
  epistemicState: epistemicStateSchema,
  payload: z.record(z.string(), z.unknown()),
});

export type DomainEvent = z.infer<typeof domainEventSchema>;
