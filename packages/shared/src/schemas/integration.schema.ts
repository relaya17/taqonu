import { z } from "zod";
import { INTEGRATION_PROVIDERS } from "../constants/integrations.js";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);

export const integrationStatusSchema = z.enum([
  "CONNECTED",
  "DISCONNECTED",
  "ERROR",
  "PENDING",
]);

export const integrationPermissionSchema = z.object({
  key: z.string().min(1).max(120),
  granted: z.boolean(),
  requiresApproval: z.boolean().default(false),
});

export const integrationAccountSchema = z.object({
  id: uuidSchema,
  provider: integrationProviderSchema,
  displayName: z.string().min(1).max(200),
  status: integrationStatusSchema,
  permissions: z.array(integrationPermissionSchema),
  secretsPolicy: z.object({
    metadataAllowed: z.literal(true),
    secretValuesAllowed: z.literal(false),
  }),
  connectedAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});

export const deploymentStatusSchema = z.enum([
  "QUEUED",
  "BUILDING",
  "READY",
  "ERROR",
  "CANCELED",
  "UNKNOWN",
]);

export const deploymentSchema = z.object({
  id: uuidSchema,
  provider: z.enum(["vercel", "netlify", "render"]),
  projectId: uuidSchema.nullable(),
  externalProjectId: z.string().min(1).max(200),
  externalDeploymentId: z.string().min(1).max(200),
  status: deploymentStatusSchema,
  url: z.string().url().nullable(),
  commitSha: z.string().max(64).nullable(),
  errorSummary: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type IntegrationAccount = z.infer<typeof integrationAccountSchema>;
export type Deployment = z.infer<typeof deploymentSchema>;
