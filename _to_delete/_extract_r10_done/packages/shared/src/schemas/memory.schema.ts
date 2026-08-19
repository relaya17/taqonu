import { z } from "zod";
import { MEMORY_STATUSES, MEMORY_TYPES, OBSERVATION_MODES } from "../constants/memory.js";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  knowledgeCategorySchema,
  uuidSchema,
} from "./common.schema.js";

export const memoryTypeSchema = z.enum(MEMORY_TYPES);
export const memoryStatusSchema = z.enum(MEMORY_STATUSES);
export const observationModeSchema = z.enum(OBSERVATION_MODES);

export const memorySourceTypeSchema = z.enum([
  "USER",
  "AGENT",
  "GITHUB",
  "DOCUMENT",
  "CONVERSATION",
  "INTEGRATION",
  "WEB_RESEARCH",
  "SYSTEM",
]);

export const memoryEvidenceSchema = z.object({
  id: uuidSchema,
  kind: z.string().min(1).max(64),
  reference: z.string().min(1).max(500),
  excerpt: z.string().max(4000).optional(),
});

export const memorySchema = z.object({
  id: uuidSchema,
  /** Tenant boundary (P0 fix): every stored memory is owner-scoped, same as evidenceRecordSchema.ownerId. */
  ownerId: uuidSchema,
  type: memoryTypeSchema,
  projectId: uuidSchema.nullable(),
  statement: z.string().min(1).max(4000),
  reason: z.array(z.string().min(1).max(500)).default([]),
  status: memoryStatusSchema,
  confidence: confidenceSchema,
  category: knowledgeCategorySchema,
  epistemicState: epistemicStateSchema,
  observationMode: observationModeSchema,
  source: z.string().min(1).max(200),
  sourceType: memorySourceTypeSchema,
  sourceId: z.string().min(1).max(200).nullable(),
  evidence: z.array(memoryEvidenceSchema).default([]),
  supersededBy: uuidSchema.nullable(),
  validFrom: isoDateTimeSchema.nullable(),
  validUntil: isoDateTimeSchema.nullable(),
  observedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  createdBy: z.string().min(1).max(200),
  scope: z.enum(["GLOBAL", "PROJECT", "REPOSITORY"]).default("PROJECT"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  /**
   * Per-agent scoping (P1 fix): the agent (kernel catalog id, e.g.
   * "ORCHESTRATOR", "JUDGE", or a plugin id) that WROTE this memory —
   * distinct from `ownerId` (the tenant who owns it) and `createdBy`
   * (already existed, a loose free-text string, e.g. "user"). Optional and
   * nullable: most memories are still written without attributing a
   * specific writing agent, and that is unchanged/valid.
   */
  agentId: z.string().max(120).nullable().optional(),
  /**
   * Per-agent scoping (P1 fix): when set to a non-null, non-empty array,
   * only the listed agent ids may retrieve this memory via
   * `retrieveMemories()`/`buildMemoryContext()` (see memory-pipeline.ts's
   * `requestingAgentId` parameter). Null/absent (the default) means
   * unchanged behavior — visible to any agent within the existing
   * `ownerId` tenant boundary. This is strictly additive, opt-in scoping,
   * never a breaking default.
   */
  allowedAgents: z.array(z.string().max(120)).nullable().optional(),
  /**
   * Provenance gate: who/when this memory was promoted to CONFIRMED via
   * `approveMemory()` — mirrors `evidenceRecordSchema`/`claimSchema`'s
   * `verifiedAt` and `patch.schema.ts`'s `approvedBy` naming convention in
   * this same package. Optional/nullable: strictly additive, most existing
   * memories (and every fixture built before this field existed) never set
   * it and remain valid.
   */
  verifiedBy: uuidSchema.nullable().optional(),
  verifiedAt: isoDateTimeSchema.nullable().optional(),
});

const createMemoryObjectSchema = z.object({
  type: memoryTypeSchema,
  projectId: uuidSchema.nullable().optional(),
  statement: z.string().min(1).max(4000),
  reason: z.array(z.string().min(1).max(500)).optional(),
  confidence: confidenceSchema.optional(),
  category: knowledgeCategorySchema,
  epistemicState: epistemicStateSchema,
  observationMode: observationModeSchema,
  source: z.string().min(1).max(200),
  sourceType: memorySourceTypeSchema,
  sourceId: z.string().min(1).max(200).nullable().optional(),
  evidence: z.array(memoryEvidenceSchema.omit({ id: true })).optional(),
  validFrom: isoDateTimeSchema.nullable().optional(),
  validUntil: isoDateTimeSchema.nullable().optional(),
  observedAt: isoDateTimeSchema.nullable().optional(),
  scope: z.enum(["GLOBAL", "PROJECT", "REPOSITORY"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  /** See `memorySchema.agentId` — the agent that wrote this memory. */
  agentId: z.string().max(120).nullable().optional(),
  /** See `memorySchema.allowedAgents` — opt-in per-agent read scoping. */
  allowedAgents: z.array(z.string().max(120)).nullable().optional(),
});

/**
 * FACT-assertion poisoning gate (P0 fix).
 *
 * `sourceType` on create is a self-reported string chosen by whoever is
 * calling POST /api/v1/memory — nothing about it is cryptographically or
 * structurally verified at this boundary (that's exactly what makes
 * `createMemorySchema` different from the internal `memorySchema`, which is
 * also used by trusted, server-only construction paths such as
 * `approveMemory()`). If any caller could mint a memory that already claims
 * FACT/VERIFIED/CONFIRMED, a single malicious or merely careless write
 * poisons every downstream consumer that weights high-epistemic-state
 * memories more heavily (see `retrieveMemories()` in memory-pipeline.ts,
 * which score-boosts FACT/VERIFIED by +0.2 and CONFIRMED/OBSERVED by +0.12).
 * So every `sourceType` is capped below the top of the trust ladder at
 * create time; the only way up is the explicit, server-controlled
 * `approveMemory()` transition.
 *
 * Trust-mapping judgment call (a deliberate product/security decision, not
 * an "obvious" fact — documented here so it can be revisited deliberately):
 *  - SYSTEM / GITHUB: backed by our own pipeline output or git provenance
 *    (commit SHAs, PR numbers) that a caller cannot fabricate through this
 *    endpoint alone. Allowed up to CONFIRMED — but never FACT/VERIFIED,
 *    which stay reserved for the evidence/claim pipeline
 *    (`evidenceRecordSchema` / `claimSchema`) and are never asserted
 *    directly via memory create.
 *  - DOCUMENT / INTEGRATION / WEB_RESEARCH: content pulled from an external
 *    surface with *some* structure but no verification of correctness —
 *    capped at INFERRED.
 *  - USER / AGENT / CONVERSATION: pure self-reported assertions ("trust
 *    me") — capped at PROPOSED, the lowest pending-review tier.
 */
const EPISTEMIC_TRUST_RANK: Partial<
  Record<z.infer<typeof epistemicStateSchema>, number>
> = {
  UNVERIFIED: 1,
  ASSUMED: 1,
  PROPOSED: 1,
  INFERRED: 2,
  OBSERVED: 3,
  CONFIRMED: 4,
  VERIFIED: 5,
  FACT: 5,
};

const SOURCE_TRUST_CEILING: Record<
  z.infer<typeof memorySourceTypeSchema>,
  z.infer<typeof epistemicStateSchema>
> = {
  SYSTEM: "CONFIRMED",
  GITHUB: "CONFIRMED",
  DOCUMENT: "INFERRED",
  INTEGRATION: "INFERRED",
  WEB_RESEARCH: "INFERRED",
  USER: "PROPOSED",
  AGENT: "PROPOSED",
  CONVERSATION: "PROPOSED",
};

/**
 * Clamp a client-requested `epistemicState` to the highest state its
 * `sourceType` is trusted to claim directly. States outside the trust
 * ladder (e.g. STALE, CONTRADICTED, CONFLICTED, UNKNOWN,
 * INSUFFICIENT_EVIDENCE) are negative/error states, not claims of
 * certainty — they pass through unchanged.
 */
export function capEpistemicStateForSource(
  sourceType: z.infer<typeof memorySourceTypeSchema>,
  requested: z.infer<typeof epistemicStateSchema>,
): z.infer<typeof epistemicStateSchema> {
  const requestedRank = EPISTEMIC_TRUST_RANK[requested];
  if (requestedRank === undefined) return requested;
  const ceiling = SOURCE_TRUST_CEILING[sourceType];
  const ceilingRank = EPISTEMIC_TRUST_RANK[ceiling] ?? 0;
  return requestedRank > ceilingRank ? ceiling : requested;
}

export const createMemorySchema = createMemoryObjectSchema.transform((data) => ({
  ...data,
  epistemicState: capEpistemicStateForSource(data.sourceType, data.epistemicState),
}));

export type Memory = z.infer<typeof memorySchema>;
export type CreateMemory = z.infer<typeof createMemorySchema>;
export type MemoryEvidence = z.infer<typeof memoryEvidenceSchema>;
