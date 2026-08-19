import type { AgentRunResult } from "@atlas/shared";
import {
  runProposalBackedSpecialist,
  type ProposalBackedSpecialistInput,
} from "./llm-specialist-run.js";

/**
 * RESEARCHER fabric run backed by a real LLM proposal — same
 * propose-never-execute shape as `code-engineer-dispatch.ts`: the model
 * proposes, `submitAgentProposal()` validates it and puts it through
 * `dispatchAgentAction()`, and the gate's decision becomes the run status.
 *
 * ENTITY/ACTION JUSTIFICATION — `DOCUMENT` + `READ`, argued against
 * `DEFAULT_ENTITY_POLICIES`'s doc comments (entity-policies.ts):
 *
 *  - `DOCUMENT` is documented as "unstructured or semi-structured
 *    content/files (contracts, uploaded attachments, generated reports)".
 *    RESEARCHER's whole specialty per the catalog is "Authorized external
 *    sources → Evidence packages" with `allowedTools: ["knowledge_search",
 *    "ingest_source", "verify_url"]` — it reads allow-listed source
 *    documents and collates them. `RECORD` would be the generic catch-all
 *    for something that isn't better described, and this *is* better
 *    described; `CASE` carries a legal/compliance lifecycle this specialist
 *    has nothing to do with; `CONFIGURATION` is control-plane settings.
 *  - `READ`, not `CREATE`: this specialist is `canWriteCode: false` with
 *    `forbiddenTools: ["apply_patch", "unofficial_scrape_as_official"]`, and
 *    the proposal it emits is a request to read/verify sources, not to
 *    persist anything. Per the same table, `DOCUMENT.READ` is `READ_ONLY`
 *    and requires no approval — the honest, lowest-privilege tier for a
 *    read-oriented specialist, and a deliberate contrast with
 *    CODE_ENGINEER's `RECORD.CREATE` write tier. Proposing a write tier this
 *    agent never exercises would inflate every one of its audit entries.
 *    (Note the ingest path itself is unaffected: `POST
 *    /api/v1/knowledge/ingest` keeps its own auth + allow-list checks.)
 *
 * Returns `null` when this path cannot run at all (no valid owner id), so
 * the caller falls back to the read-only stub.
 */
export async function runResearcherSpecialistViaLlm(
  input: ProposalBackedSpecialistInput,
): Promise<AgentRunResult | null> {
  return runProposalBackedSpecialist(
    {
      agentId: "RESEARCHER",
      allowedActions: [{ entityType: "DOCUMENT", action: "READ" }],
      // DECISIONS is the Current-State slice retrieved/verified source
      // material feeds (see `inferEvidenceCategory`, which maps
      // DECISION_LOG/MEMORY-shaped provenance there) — stated explicitly
      // because `evidence.schema.ts` forbids collapsing slices.
      evidenceCategory: "DECISIONS",
      routeLabel: "agent-fabric.dispatch.researcher",
    },
    input,
  );
}
