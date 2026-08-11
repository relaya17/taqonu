import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

/** Personal source connections — each user brings their own GitHub / machine. */
export const sourceConnectionKindSchema = z.enum(["github", "local"]);

export const connectGithubRequestSchema = z.object({
  /** Fine-grained or classic PAT with read-only repo scope (personal instance). */
  token: z.string().min(8).max(500),
  displayLabel: z.string().min(1).max(120).optional(),
});

export const connectLocalRequestSchema = z.object({
  /** Absolute path to a folder of git repos on the machine running the API. */
  reposRoot: z.string().min(1).max(1000),
  displayLabel: z.string().min(1).max(120).optional(),
});

export const githubConnectionPublicSchema = z.object({
  kind: z.literal("github"),
  id: uuidSchema,
  status: z.enum(["CONNECTED", "DISCONNECTED", "ERROR"]),
  login: z.string().min(1).max(200).nullable(),
  displayLabel: z.string().min(1).max(120).nullable(),
  tokenConfigured: z.boolean(),
  scopesHint: z.string().max(200).nullable(),
  connectedAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema,
  lastError: z.string().max(500).nullable(),
});

export const localConnectionPublicSchema = z.object({
  kind: z.literal("local"),
  id: uuidSchema,
  status: z.enum(["CONNECTED", "DISCONNECTED", "ERROR"]),
  reposRoot: z.string().min(1).max(1000).nullable(),
  displayLabel: z.string().min(1).max(120).nullable(),
  connectedAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema,
  lastError: z.string().max(500).nullable(),
  lastScanAt: isoDateTimeSchema.nullable(),
  lastScanRepoCount: z.number().int().min(0).nullable(),
});

export const sourceConnectionsResponseSchema = z.object({
  github: githubConnectionPublicSchema.nullable(),
  local: localConnectionPublicSchema.nullable(),
});

export const importGithubReposRequestSchema = z.object({
  /** Import all listed, or only these full names if provided. */
  fullNames: z.array(z.string().min(3).max(200)).max(200).optional(),
  reconcile: z.boolean().default(true),
});

export const scanLocalRequestSchema = z.object({
  reconcile: z.boolean().default(true),
  maxDepth: z.number().int().min(1).max(4).default(2),
});

export type ConnectGithubRequest = z.infer<typeof connectGithubRequestSchema>;
export type ConnectLocalRequest = z.infer<typeof connectLocalRequestSchema>;
export type GithubConnectionPublic = z.infer<typeof githubConnectionPublicSchema>;
export type LocalConnectionPublic = z.infer<typeof localConnectionPublicSchema>;
