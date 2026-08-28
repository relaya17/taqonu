/**
 * Stage 19 — Hypothesis Engine.
 *
 * Generates and tracks engineering hypotheses based on evidence.
 * A hypothesis is a testable prediction about system behavior.
 *
 * This is a scaffold for the full hypothesis engine described in ADR-016.
 * It tracks hypotheses through their lifecycle without yet implementing
 * the full automated verification pipeline.
 */

import { z } from "zod";
import { osStore, type StoredHypothesis } from "../store/os-store.js";

export const hypothesisStatusSchema = z.enum([
  "PROPOSED",      // Initial state
  "TESTING",       // Being actively tested
  "SUPPORTED",     // Evidence supports hypothesis
  "REFUTED",       // Evidence contradicts hypothesis
  "INCONCLUSIVE",  // Not enough evidence
  "SUPERSEDED",    // Replaced by a better hypothesis
]);

export type HypothesisStatus = z.infer<typeof hypothesisStatusSchema>;

export const hypothesisSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: hypothesisStatusSchema,
  
  /** The testable prediction */
  statement: z.string().min(10).max(1000),
  
  /** What domain does this hypothesis address? */
  domain: z.enum([
    "PERFORMANCE",
    "RELIABILITY", 
    "SECURITY",
    "CORRECTNESS",
    "ARCHITECTURE",
    "INTEGRATION",
  ]),
  
  /** How would we know if this is true? */
  verificationCriteria: z.array(z.string()).min(1),
  
  /** Evidence IDs that support this hypothesis */
  supportingEvidenceIds: z.array(z.string().uuid()).default([]),
  
  /** Evidence IDs that contradict this hypothesis */
  contradictingEvidenceIds: z.array(z.string().uuid()).default([]),
  
  /** Confidence score (0-1) based on evidence */
  confidence: z.number().min(0).max(1).default(0.5),
  
  /** Tags for categorization */
  tags: z.array(z.string()).default([]),
  
  /** Optional parent hypothesis ID (for refinements) */
  parentId: z.string().uuid().nullable().default(null),
});

export type Hypothesis = z.infer<typeof hypothesisSchema>;

/** Convert to stored format */
function toStored(h: Hypothesis): StoredHypothesis {
  return {
    id: h.id,
    projectId: h.projectId,
    createdBy: h.createdBy,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    status: h.status,
    statement: h.statement,
    domain: h.domain,
    verificationCriteria: [...h.verificationCriteria],
    supportingEvidenceIds: [...h.supportingEvidenceIds],
    contradictingEvidenceIds: [...h.contradictingEvidenceIds],
    confidence: h.confidence,
    tags: [...h.tags],
    parentId: h.parentId,
  };
}

/** Convert from stored format */
function fromStored(s: StoredHypothesis): Hypothesis {
  return hypothesisSchema.parse(s);
}

export interface HypothesisCreateInput {
  projectId?: string | null;
  createdBy: string;
  statement: string;
  domain: Hypothesis["domain"];
  verificationCriteria: string[];
  tags?: string[];
  parentId?: string | null;
}

/**
 * Create a new hypothesis.
 */
export function createHypothesis(input: HypothesisCreateInput): Hypothesis {
  const now = new Date().toISOString();
  const hypothesis: Hypothesis = {
    id: crypto.randomUUID(),
    projectId: input.projectId ?? null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    status: "PROPOSED",
    statement: input.statement,
    domain: input.domain,
    verificationCriteria: input.verificationCriteria,
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    confidence: 0.5,
    tags: input.tags ?? [],
    parentId: input.parentId ?? null,
  };
  
  osStore.setHypothesis(toStored(hypothesis));
  return hypothesis;
}

/**
 * Add supporting evidence to a hypothesis.
 */
export function addSupportingEvidence(
  hypothesisId: string,
  evidenceId: string,
): Hypothesis | null {
  const stored = osStore.getHypothesis(hypothesisId);
  if (!stored) return null;
  
  const hypothesis = fromStored(stored);
  const updated: Hypothesis = {
    ...hypothesis,
    updatedAt: new Date().toISOString(),
    supportingEvidenceIds: [...hypothesis.supportingEvidenceIds, evidenceId],
    confidence: computeConfidence(
      hypothesis.supportingEvidenceIds.length + 1,
      hypothesis.contradictingEvidenceIds.length,
    ),
  };
  
  osStore.setHypothesis(toStored(updated));
  return updated;
}

/**
 * Add contradicting evidence to a hypothesis.
 */
export function addContradictingEvidence(
  hypothesisId: string,
  evidenceId: string,
): Hypothesis | null {
  const stored = osStore.getHypothesis(hypothesisId);
  if (!stored) return null;
  
  const hypothesis = fromStored(stored);
  const updated: Hypothesis = {
    ...hypothesis,
    updatedAt: new Date().toISOString(),
    contradictingEvidenceIds: [...hypothesis.contradictingEvidenceIds, evidenceId],
    confidence: computeConfidence(
      hypothesis.supportingEvidenceIds.length,
      hypothesis.contradictingEvidenceIds.length + 1,
    ),
  };
  
  osStore.setHypothesis(toStored(updated));
  return updated;
}

/**
 * Update hypothesis status based on evidence.
 */
export function updateHypothesisStatus(
  hypothesisId: string,
  status: HypothesisStatus,
): Hypothesis | null {
  const stored = osStore.getHypothesis(hypothesisId);
  if (!stored) return null;
  
  const hypothesis = fromStored(stored);
  const updated: Hypothesis = {
    ...hypothesis,
    updatedAt: new Date().toISOString(),
    status,
  };
  
  osStore.setHypothesis(toStored(updated));
  return updated;
}

/**
 * List hypotheses, optionally filtered.
 */
export function listHypotheses(filter?: {
  projectId?: string | null | undefined;
  status?: HypothesisStatus | undefined;
  domain?: Hypothesis["domain"] | undefined;
}): Hypothesis[] {
  let hypotheses = osStore.listHypotheses().map(fromStored);
  
  if (filter?.projectId !== undefined) {
    hypotheses = hypotheses.filter(h => h.projectId === filter.projectId);
  }
  if (filter?.status) {
    hypotheses = hypotheses.filter(h => h.status === filter.status);
  }
  if (filter?.domain) {
    hypotheses = hypotheses.filter(h => h.domain === filter.domain);
  }
  
  return hypotheses.sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Compute confidence score based on evidence ratio.
 */
function computeConfidence(supporting: number, contradicting: number): number {
  const total = supporting + contradicting;
  if (total === 0) return 0.5;
  // Bayesian-ish update with prior of 0.5
  return (supporting + 1) / (total + 2);
}

/**
 * Generate hypothesis suggestions from recent evidence.
 * This is a placeholder for the full ML-based suggestion engine.
 */
export function suggestHypotheses(_projectId: string | null): HypothesisCreateInput[] {
  // Placeholder: in full implementation, this would analyze
  // recent evidence, patterns, and known issues to suggest hypotheses
  return [];
}
