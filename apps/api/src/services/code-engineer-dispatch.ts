import type { AgentRunResult } from "@atlas/shared";
import {
  runProposalBackedSpecialist,
  type ProposalBackedSpecialistInput,
} from "./llm-specialist-run.js";

/**
 * CODE_ENGINEER fabric run backed by a real LLM proposal — not the read-only
 * `runSpecialistStub`, and not an executor. The model PROPOSES; the proposal
 * is validated (`agentProposalSchema`) and then gated by
 * `dispatchAgentAction()` via `submitAgentProposal()`; the gate's decision
 * becomes this run's status. There is no code path from here that applies a
 * patch, which is exactly what the catalog entry promises: CODE_ENGINEER has
 * `canWriteCode: true` but `forbiddenTools: ["apply_patch_without_approval"]`
 * — "patch-only-gated", in the words of `runSpecialistStub`'s own
 * `WRITE=patch-only-gated` claim.
 *
 * ENTITY/ACTION JUSTIFICATION — `RECORD` + `CREATE`, argued against
 * `DEFAULT_ENTITY_POLICIES`'s doc comments (entity-policies.ts) the same way
 * the SECURITY branch in `agent-fabric.ts` argued for `CASE`:
 *
 *  - `RECORD` is documented as "a general operational/business record that
 *    isn't better described by a more specific bucket". What this specialist
 *    actually produces is a Patch Artifact proposal — a tracked operational
 *    item awaiting review. Nothing more specific fits: `CASE` is "a tracked
 *    unit of work with a lifecycle and often legal/compliance weight (a
 *    legal matter, a support case, an incident)", and a proposed refactor
 *    carries no legal/compliance weight — claiming it does would inflate the
 *    audit trail's framing the same way SECURITY's incident-shaped findings
 *    legitimately deflate onto `CASE`. `DOCUMENT` ("unstructured or
 *    semi-structured content/files") was the closest runner-up since a patch
 *    is file content, but the thing being created here is the *proposal
 *    record*, not a stored document/attachment. `CONFIGURATION` is reserved
 *    for control-plane/system settings and is already used, deliberately, by
 *    the coarse route-level gate in `agent-fabric.ts`.
 *  - `CREATE`, not `EXECUTE` or `UPDATE`: per the same table's design-intent
 *    comment, `EXECUTE` means "run this transaction / apply this
 *    configuration" — i.e. actually applying the patch, which this
 *    specialist is forbidden from doing — and `UPDATE` means mutating
 *    existing business data, which it also never does. Creating a new
 *    proposal record is `CREATE` (LOW_RISK_WRITE, no blanket approval
 *    requirement), and the far riskier act of *applying* an approved patch
 *    stays where it already is: behind `code.ts`'s own patch apply/rollback
 *    gate. Overstating this call as `EXECUTE` would misrepresent what
 *    happened on the audit entry.
 *
 * Returns `null` when this path cannot run at all (no valid owner id), so
 * the caller falls back to the read-only stub — the same contract
 * `runSecuritySpecialistViaSentinel` uses when there is no workspace root.
 */
export async function runCodeEngineerSpecialistViaLlm(
  input: ProposalBackedSpecialistInput,
): Promise<AgentRunResult | null> {
  return runProposalBackedSpecialist(
    {
      agentId: "CODE_ENGINEER",
      allowedActions: [{ entityType: "RECORD", action: "CREATE" }],
      // CODE is the Current-State slice a patch proposal's evidence (failing
      // test, requirement, file path) belongs to; `evidence.schema.ts`
      // forbids silently collapsing slices, so this is stated rather than
      // guessed.
      evidenceCategory: "CODE",
      routeLabel: "agent-fabric.dispatch.code-engineer",
    },
    input,
  );
}
