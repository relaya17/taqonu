/**
 * Stage 19 — Golden Projects Registry.
 *
 * Manages the registry of "golden" reference projects that serve as
 * exemplars for quality, patterns, and best practices.
 *
 * Golden projects are used for:
 * - Training agent evaluation criteria
 * - Comparing new projects against proven patterns
 * - Generating exemplar-based suggestions
 */

import { z } from "zod";
import { osStore, type StoredGoldenProject } from "../store/os-store.js";
import { defaultGoldenRoot, goldenFixtureRoot } from "./golden-root.js";

export const goldenProjectStatusSchema = z.enum([
  "CANDIDATE",    // Nominated but not yet verified
  "VERIFIED",     // Passed golden criteria
  "GRADUATED",    // No longer golden (evolved past)
  "SUSPENDED",    // Temporarily removed from golden set
]);

export type GoldenProjectStatus = z.infer<typeof goldenProjectStatusSchema>;

export const goldenProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  rootPath: z.string(),
  status: goldenProjectStatusSchema,
  
  /** Why is this project golden? */
  goldenReason: z.string().min(10).max(1000),
  
  /** What domains does this project exemplify? */
  domains: z.array(z.enum([
    "API_DESIGN",
    "DATABASE_SCHEMA",
    "SECURITY",
    "TESTING",
    "DOCUMENTATION",
    "PERFORMANCE",
    "ARCHITECTURE",
    "ERROR_HANDLING",
  ])).min(1),
  
  /** Quality scores (0-1) for various dimensions */
  qualityScores: z.object({
    codeQuality: z.number().min(0).max(1),
    testCoverage: z.number().min(0).max(1),
    documentation: z.number().min(0).max(1),
    security: z.number().min(0).max(1),
    maintainability: z.number().min(0).max(1),
  }),
  
  /** When was this project last analyzed? */
  lastAnalyzedAt: z.string().datetime().nullable(),
  
  /** Evidence IDs supporting golden status */
  evidenceIds: z.array(z.string().uuid()).default([]),
  
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type GoldenProject = z.infer<typeof goldenProjectSchema>;

/** Convert to stored format */
function toStored(p: GoldenProject): StoredGoldenProject {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    rootPath: p.rootPath,
    status: p.status,
    goldenReason: p.goldenReason,
    domains: [...p.domains],
    qualityScores: { ...p.qualityScores },
    lastAnalyzedAt: p.lastAnalyzedAt,
    evidenceIds: [...p.evidenceIds],
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Convert from stored format */
function fromStored(s: StoredGoldenProject): GoldenProject {
  return goldenProjectSchema.parse(s);
}

/**
 * Get the default golden project (BrokerOS fixture).
 */
export function getDefaultGoldenProject(): GoldenProject {
  const fixturePath = goldenFixtureRoot();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "BrokerOS Reference",
    description: "Reference implementation for real estate brokerage SaaS",
    rootPath: fixturePath,
    status: "VERIFIED",
    goldenReason: "Comprehensive reference implementation demonstrating Atlas patterns",
    domains: ["API_DESIGN", "DATABASE_SCHEMA", "TESTING", "ERROR_HANDLING"],
    qualityScores: {
      codeQuality: 0.85,
      testCoverage: 0.75,
      documentation: 0.80,
      security: 0.90,
      maintainability: 0.85,
    },
    lastAnalyzedAt: new Date().toISOString(),
    evidenceIds: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * List all registered golden projects.
 */
export function listGoldenProjects(filter?: {
  status?: GoldenProjectStatus | undefined;
  domain?: GoldenProject["domains"][number] | undefined;
}): GoldenProject[] {
  const projects = osStore.listGoldenProjects().map(fromStored);
  
  // Include default if no projects registered
  const all = projects.length > 0 ? projects : [getDefaultGoldenProject()];
  
  let filtered = all;
  if (filter?.status) {
    filtered = filtered.filter(p => p.status === filter.status);
  }
  if (filter?.domain) {
    filtered = filtered.filter(p => p.domains.includes(filter.domain!));
  }
  
  return filtered;
}

/**
 * Register a new golden project.
 */
export function registerGoldenProject(input: {
  name: string;
  description?: string;
  rootPath: string;
  goldenReason: string;
  domains: GoldenProject["domains"];
}): GoldenProject {
  const now = new Date().toISOString();
  const project: GoldenProject = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description ?? "",
    rootPath: input.rootPath,
    status: "CANDIDATE",
    goldenReason: input.goldenReason,
    domains: input.domains,
    qualityScores: {
      codeQuality: 0.5,
      testCoverage: 0.5,
      documentation: 0.5,
      security: 0.5,
      maintainability: 0.5,
    },
    lastAnalyzedAt: null,
    evidenceIds: [],
    createdAt: now,
    updatedAt: now,
  };
  
  osStore.setGoldenProject(toStored(project));
  return project;
}

/**
 * Update golden project status.
 */
export function updateGoldenProjectStatus(
  projectId: string,
  status: GoldenProjectStatus,
): GoldenProject | null {
  const stored = osStore.getGoldenProject(projectId);
  if (!stored) return null;
  
  const project = fromStored(stored);
  const updated: GoldenProject = {
    ...project,
    status,
    updatedAt: new Date().toISOString(),
  };
  
  osStore.setGoldenProject(toStored(updated));
  return updated;
}

/**
 * Update golden project quality scores.
 */
export function updateGoldenProjectScores(
  projectId: string,
  scores: Partial<GoldenProject["qualityScores"]>,
): GoldenProject | null {
  const stored = osStore.getGoldenProject(projectId);
  if (!stored) return null;
  
  const project = fromStored(stored);
  const updated: GoldenProject = {
    ...project,
    qualityScores: { ...project.qualityScores, ...scores },
    lastAnalyzedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  osStore.setGoldenProject(toStored(updated));
  return updated;
}

/**
 * Find golden projects that are exemplars for a given domain.
 */
export function findExemplarsForDomain(
  domain: GoldenProject["domains"][number],
): GoldenProject[] {
  return listGoldenProjects({ status: "VERIFIED", domain })
    .sort((a, b) => {
      const avgA = Object.values(a.qualityScores).reduce((s, v) => s + v, 0) / 5;
      const avgB = Object.values(b.qualityScores).reduce((s, v) => s + v, 0) / 5;
      return avgB - avgA;
    });
}

/**
 * Get the resolved golden root path.
 */
export function getGoldenRoot(): string {
  return defaultGoldenRoot();
}
