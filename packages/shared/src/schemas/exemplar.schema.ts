import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

/** Cloneable slices cut FROM a complete working system — never floating snippets. */
export const EXEMPLAR_UNIT_KINDS = [
  "WHOLE",
  "AUTH",
  "SESSION",
  "CONFIG",
  "VERSIONING",
  "PAYMENTS",
  "HEALTH",
  "DEPLOY",
  "TESTS",
  "STRUCTURE",
] as const;

export const exemplarUnitKindSchema = z.enum(EXEMPLAR_UNIT_KINDS);

export const exemplarKindSchema = z.enum([
  "mini_app",
  "saas",
  "large_app",
  "imported",
]);

export const exemplarVisibilitySchema = z.enum(["catalog", "personal"]);

/**
 * Gate for calling a system "complete enough to clone".
 * If any flag is false, clone may still run but `cloneReady` is false.
 */
export const exemplarCompletenessSchema = z.object({
  builds: z.boolean(),
  runsLocally: z.boolean(),
  hasAuth: z.boolean(),
  hasConfigAndVersions: z.boolean(),
  hasTests: z.boolean(),
  hasDeployPath: z.boolean(),
  hasEnvExample: z.boolean(),
  hasCloneMap: z.boolean(),
});

export const exemplarUnitSchema = z.object({
  id: z.string().min(1).max(80),
  kind: exemplarUnitKindSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  /** Paths relative to the exemplar sourceRoot (posix). */
  paths: z.array(z.string().min(1).max(500)).min(1).max(80),
  dependsOn: z.array(z.string().max(80)).default([]),
});

export const exemplarRecordSchema = z.object({
  id: uuidSchema,
  /** Tenant who ingested it. Catalog rows use STUB_OWNER_ID and are readable by all signed-in users. */
  ownerId: uuidSchema,
  visibility: exemplarVisibilitySchema,
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1).max(200),
  description: z.string().max(4000),
  kind: exemplarKindSchema,
  version: z.string().min(1).max(40),
  /**
   * Absolute path on the API host, or repo-relative path (e.g. fixtures/exemplar-saas-mini).
   * Clone reads files only from this root.
   */
  sourceRoot: z.string().min(1).max(1000),
  completeness: exemplarCompletenessSchema,
  units: z.array(exemplarUnitSchema).min(1).max(40),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  createdBy: z.string().min(1).max(200),
});

export const ingestExemplarBodySchema = z.object({
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(4000).optional(),
  kind: exemplarKindSchema.default("imported"),
  version: z.string().min(1).max(40).default("1.0.0"),
  /** Absolute directory on the API host containing atlas-exemplar.json + source. */
  sourceRoot: z.string().min(1).max(1000),
  visibility: exemplarVisibilitySchema.default("personal"),
});

export const cloneExemplarBodySchema = z.object({
  projectId: uuidSchema,
  /** Omit or `WHOLE` to clone the entire mapped tree. Otherwise a unit id. */
  unitId: z.string().min(1).max(80).optional(),
  /** Optional prefix under the project workspace (posix, no `..`). */
  targetPrefix: z.string().max(200).optional(),
});

export const studioWriteFileBodySchema = z.object({
  projectId: uuidSchema,
  path: z.string().min(1).max(1000),
  content: z.string().max(400_000),
});

export type ExemplarUnitKind = z.infer<typeof exemplarUnitKindSchema>;
export type ExemplarKind = z.infer<typeof exemplarKindSchema>;
export type ExemplarVisibility = z.infer<typeof exemplarVisibilitySchema>;
export type ExemplarCompleteness = z.infer<typeof exemplarCompletenessSchema>;
export type ExemplarUnit = z.infer<typeof exemplarUnitSchema>;
export type ExemplarRecord = z.infer<typeof exemplarRecordSchema>;
export type IngestExemplarBody = z.infer<typeof ingestExemplarBodySchema>;
export type CloneExemplarBody = z.infer<typeof cloneExemplarBodySchema>;
export type StudioWriteFileBody = z.infer<typeof studioWriteFileBodySchema>;

export function isExemplarCloneReady(
  completeness: ExemplarCompleteness,
): boolean {
  return (
    completeness.builds &&
    completeness.runsLocally &&
    completeness.hasAuth &&
    completeness.hasConfigAndVersions &&
    completeness.hasTests &&
    completeness.hasDeployPath &&
    completeness.hasEnvExample &&
    completeness.hasCloneMap
  );
}
