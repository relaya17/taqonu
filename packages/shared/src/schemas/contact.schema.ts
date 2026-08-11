import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

export const contactLeadSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(120),
  email: z.string().email().max(254),
  company: z.string().max(160).nullable(),
  role: z.string().max(120).nullable(),
  message: z.string().min(3).max(4000),
  source: z.enum(["investors", "site", "other"]).default("investors"),
  locale: z.enum(["he", "en", "ar"]).optional(),
  createdAt: isoDateTimeSchema,
});

export const createContactLeadSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(254),
  company: z.string().max(160).optional(),
  role: z.string().max(120).optional(),
  message: z.string().min(3).max(4000),
  source: z.enum(["investors", "site", "other"]).optional(),
  locale: z.enum(["he", "en", "ar"]).optional(),
});

export type ContactLead = z.infer<typeof contactLeadSchema>;
export type CreateContactLead = z.infer<typeof createContactLeadSchema>;
