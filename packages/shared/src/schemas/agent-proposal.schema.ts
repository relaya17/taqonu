import { z } from "zod";
import { fabricAgentIdSchema } from "./agent-fabric.schema.js";
import { evidenceRecordSchema } from "./evidence.schema.js";
import { confidenceSchema, uuidSchema } from "./common.schema.js";

/**
 * AgentProposal — the contract an LLM/agent produces to PROPOSE an action,
 * never to execute one directly.
 *
 * `apps/api/src/services/agent-dispatch-guard.ts` (`dispatchAgentAction`)
 * already gates every agent/automation-initiated entity action through the
 * Policy Engine + Risk Engine + Unified Audit Log + Approval flow — but it
 * sits BELOW the point where an agent's intended action gets authorized. It
 * has no notion of "here is what an LLM proposed to do and why it thinks
 * that's the right move": its `DispatchAgentActionOptions` carries an
 * already-decided `entityType`/`action`, an optional numeric `confidence`,
 * and an optional `evidenceCount` — none of which capture the agent's
 * actual claims, the evidence those claims rest on, or its rationale for
 * proposing this specific action.
 *
 * `AgentProposal` is that missing layer ABOVE `dispatchAgentAction()`, not
 * a replacement for it. An LLM/agent call site (Phase 1 — none exists yet;
 * see `apps/api/src/services/agent-proposal-stub-generator.ts`) produces an
 * `AgentProposal`; `apps/api/src/services/agent-proposal.ts`
 * (`submitAgentProposal`) validates it against `agentProposalSchema` and
 * translates it into a `dispatchAgentAction()` call, carrying `claims` /
 * `evidence` / `rationale` into that call's audit trail. The agent never
 * gets a code path that executes anything directly — it can only ever
 * produce a proposal, which is then validated and gated, exactly mirroring
 * the "propose, don't execute" principle `dispatchAgentAction()` already
 * establishes for the layer below it.
 */
export const agentProposalActionSchema = z.object({
  /**
   * Business-entity type this proposal intends to act on once dispatched.
   * Literal values are `BusinessEntityType` from `@atlas/agent-core`
   * ("CUSTOMER" | "RECORD" | "DOCUMENT" | "FINANCIAL_TRANSACTION" | "CASE" |
   * "COMMUNICATION" | "CONFIGURATION"). Kept as `z.string()` rather than a
   * mirrored `z.enum()` for the same reason `approval-request.schema.ts`
   * does: `@atlas/shared` cannot import from `@atlas/agent-core`
   * (agent-core depends on shared, never the reverse), so the closed set
   * can only be enforced where `dispatchAgentAction()` itself is called,
   * not here.
   */
  entityType: z.string().min(1).max(200),
  /**
   * Entity action this proposal intends to take. Literal values are
   * `EntityAction` from `@atlas/agent-core` ("READ" | "CREATE" | "UPDATE" |
   * "DELETE" | "EXECUTE"). Same `z.string()` rationale as `entityType`.
   */
  action: z.string().min(1).max(200),
});

export const agentProposalSchema = z.object({
  /**
   * Which fabric specialist authored this proposal — reuses the one closed
   * agent-id vocabulary (`FABRIC_AGENT_IDS` / `fabricAgentIdSchema`)
   * instead of inventing a parallel one.
   */
  agentId: fabricAgentIdSchema,
  /**
   * The task/run this proposal was produced for — ties the proposal back
   * to the agent run or plan step (`AgentPlanStep`, `AgentRunResult`) that
   * generated it.
   */
  taskId: uuidSchema,
  /** Project this proposal's action applies to, or null for cross-project/system-level proposals. */
  projectId: uuidSchema.nullable(),
  /**
   * The entity/action pair this proposal intends to eventually dispatch —
   * shaped to map 1:1 onto `DispatchAgentActionOptions.entityType` /
   * `.action` so `submitAgentProposal()` can pass it straight through with
   * no re-derivation.
   */
  action: agentProposalActionSchema,
  /**
   * Free-form parameters the proposed action would run with (never
   * secrets) — threaded through to `dispatchAgentAction()`'s `input` so it
   * lands on the resulting audit entry.
   */
  inputs: z.record(z.string(), z.unknown()).default({}),
  /**
   * The agent's explicit assertions this proposal rests on (ADR-014: a
   * claim without evidence is not a fact). Never empty — a proposal with
   * no claims gives a human/auditor nothing to evaluate, so it is rejected
   * by this schema before it ever reaches `dispatchAgentAction()`.
   */
  claims: z.array(z.string().min(1).max(4000)).min(1),
  /**
   * Real, structured evidence backing `claims` — reuses `evidenceRecordSchema`
   * (the same first-class evidence shape every other claim in this codebase
   * points to; see `evidence.schema.ts` / `claimSchema`) rather than a bare
   * string or free-text summary. Embedding the full record (not just an
   * id reference) keeps the proposal self-contained: an auditor reading the
   * resulting audit entry can see exactly what the agent based its claims
   * on without dereferencing a separate, possibly-since-changed evidence
   * store. Never empty, for the same reason `claims` is never empty.
   */
  evidence: z.array(evidenceRecordSchema).min(1),
  /**
   * The agent's own confidence in this proposal — reuses the shared 0..1
   * confidence scale (`confidenceSchema`, the same primitive
   * `evidenceRecordSchema.confidence` / `claimSchema.confidence` use), so
   * proposal confidence is comparable with every other confidence value in
   * the system rather than a bespoke scale. Threaded to
   * `dispatchAgentAction()`'s risk scorer as `options.confidence`.
   */
  confidence: confidenceSchema,
  /**
   * WHY the agent proposed this specific action — human-readable, becomes
   * part of the audit trail's WHY alongside the Risk Engine's own
   * explanation, so a human/auditor can later see not just what happened
   * but what the agent believed justified it.
   */
  rationale: z.string().min(1).max(4000),
});

export type AgentProposalAction = z.infer<typeof agentProposalActionSchema>;
export type AgentProposal = z.infer<typeof agentProposalSchema>;
