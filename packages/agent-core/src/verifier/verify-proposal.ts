import {
  SOURCE_AUTHORITY_WEIGHT,
  type AgentProposal,
  type EpistemicState,
  type EvidenceRecord,
  type SourceAuthorityRank,
} from "@atlas/shared";
import { detectSecrets } from "../secrets/detector.js";

/**
 * `verify(proposal)` — the unified verification primitive.
 *
 * Why this exists
 * ---------------
 * `dispatchAgentAction()` (apps/api/src/services/agent-dispatch-guard.ts) is
 * a GATE: it decides whether an agent's action is *allowed* to run, using
 * Policy + Risk + Approval. It deliberately says nothing about whether the
 * agent's claims are *true*. `AgentProposal` carries `claims`, `evidence`,
 * `confidence` and `rationale`, but until now nothing in this codebase ever
 * checked those against anything — a proposal asserting "confidence: 0.95"
 * backed solely by the model's own inference was indistinguishable, to
 * every downstream consumer, from one backed by a passing CI run.
 *
 * This closes that gap. It is the missing step documented as still-open in
 * `atlas-central-dispatcher-injection-defense.md` §4 item #8 and repeated
 * in the master checklist ever since: "`verify(proposal)` primitive — still
 * does not exist; `dispatchAgentAction` today is a gate only (decides
 * whether to act), it does not (yet) call verify."
 *
 * The three-verdict contract
 * --------------------------
 * - `VERIFIED`    — every check that ran passed, and at least one ran.
 * - `FAILED`      — at least one check actively found a defect.
 * - `INCONCLUSIVE` — nothing could be checked, or checks ran but could not
 *                    reach a positive conclusion.
 *
 * **The load-bearing rule: absence of a check is NEVER a pass.** A proposal
 * that no check could evaluate returns `INCONCLUSIVE`, never `VERIFIED`.
 * This is the same discipline the rest of this codebase already holds — the
 * `INSUFFICIENT_EVIDENCE` epistemic state, `agent-reputation.ts` refusing to
 * report 0%/100% off a zero-size sample, and the "honest zero" doc comment
 * on `llm.ts`'s cost accounting. A verification primitive that defaulted to
 * "VERIFIED — nothing objected" would silently launder unchecked agent
 * output into apparent proof, which is the precise failure this whole
 * control layer exists to prevent.
 *
 * A single `FAILED` dominates any number of `VERIFIED` results. Verification
 * is not a score and is deliberately not averaged: nine passing checks do
 * not offset one real defect, and collapsing them into a percentage would
 * hide exactly the finding a reviewer most needs to see.
 *
 * Extensibility
 * -------------
 * The built-in checks below are the ones that can run TODAY, offline, with
 * no tool runtime: they reason about the proposal's own evidence, authority
 * and internal consistency. The genuinely powerful checks — "run the test
 * suite", "run typecheck", "apply the patch and see if it builds" — require
 * the Tool Runtime that does not exist yet. That is why `additionalChecks`
 * is part of the signature from day one: when the tool runtime lands, a
 * `run_typecheck` check plugs in here without this primitive's contract
 * changing. Until then, this is honest about only checking what it can.
 */

export type ProposalVerificationVerdict = "VERIFIED" | "FAILED" | "INCONCLUSIVE";

export interface ProposalVerificationCheckResult {
  /** Stable identifier of the check that produced this result. */
  readonly checkId: string;
  readonly verdict: ProposalVerificationVerdict;
  /** Human-readable reason — becomes part of the audit trail's WHY. */
  readonly detail: string;
}

export interface ProposalVerificationCheck {
  readonly id: string;
  /** What this check actually examines — shown to reviewers/auditors. */
  readonly description: string;
  run(proposal: AgentProposal): ProposalVerificationCheckResult;
}

export interface ProposalVerificationResult {
  readonly verdict: ProposalVerificationVerdict;
  readonly checks: readonly ProposalVerificationCheckResult[];
  readonly rationale: string;
  /**
   * Epistemic state of the verification itself, using the project's own
   * 13-state vocabulary rather than a bespoke one:
   * `VERIFIED` → "VERIFIED", `FAILED` → "CONTRADICTED",
   * `INCONCLUSIVE` → "INSUFFICIENT_EVIDENCE".
   */
  readonly epistemicState: EpistemicState;
}

/**
 * Authority ranks that represent something a machine actually observed or
 * executed, as opposed to something a human or a model asserted.
 * `SOURCE_AUTHORITY_WEIGHT` (constants/authority.ts) orders these with
 * "lower number = higher authority"; `CI_ARTIFACT` (4) is the weakest rank
 * that still reflects a real execution, so it is the cutoff. Everything
 * below it — `REPOSITORY_CODE`, `ARCHITECTURE_DOCUMENT`,
 * `DEVELOPER_STATEMENT`, `LLM_INFERENCE` — is a statement about the world,
 * not an observation of it.
 */
const EXECUTED_EVIDENCE_MAX_WEIGHT = SOURCE_AUTHORITY_WEIGHT.CI_ARTIFACT;

/**
 * Confidence above which a proposal is treated as making a strong claim,
 * and therefore owes stronger evidence than an assertion. Chosen to sit
 * clearly inside "the agent is telling you it is sure" territory rather
 * than at a boundary, matching how `risk-score.ts` picks its own floors.
 */
const STRONG_CONFIDENCE_THRESHOLD = 0.8;

function bestAuthorityWeight(evidence: readonly EvidenceRecord[]): number {
  return evidence.reduce((best, record) => {
    const weight = SOURCE_AUTHORITY_WEIGHT[record.authorityRank as SourceAuthorityRank];
    return weight !== undefined && weight < best ? weight : best;
  }, Number.POSITIVE_INFINITY);
}

/**
 * A proposal must not carry a secret in any text a human or downstream log
 * will read. This mirrors the `redactSecrets`/`assertNoSecrets` discipline
 * already applied at the LLM call sites (routes/agent.ts, conversation.ts)
 * — here it is a verification defect rather than a redaction, because a
 * secret appearing inside an agent's own claims means it already leaked
 * into the proposal record itself.
 */
const secretsCheck: ProposalVerificationCheck = {
  id: "no-secrets-in-proposal",
  description: "Claims, rationale and evidence excerpts contain no detectable secret.",
  run(proposal) {
    const surfaces = [
      proposal.rationale,
      ...proposal.claims,
      ...proposal.evidence.map((e) => e.excerpt ?? ""),
    ].join("\n");
    const findings = detectSecrets(surfaces);
    return findings.length > 0
      ? {
          checkId: "no-secrets-in-proposal",
          verdict: "FAILED",
          detail: `Proposal text contains ${findings.length} detected secret pattern(s); a proposal must never carry credentials.`,
        }
      : {
          checkId: "no-secrets-in-proposal",
          verdict: "VERIFIED",
          detail: "No secret patterns detected in claims, rationale or evidence excerpts.",
        };
  },
};

/**
 * The circularity check. An agent citing only its own inference as the
 * evidence for its own claims has established nothing — it has restated the
 * claim in the evidence field. `LLM_INFERENCE` is deliberately the lowest
 * rank in `SOURCE_AUTHORITY_RANKS` (weight 8) precisely so this case is
 * detectable; this check is what acts on it.
 *
 * This is `INCONCLUSIVE`, NOT `FAILED`, and the distinction matters more
 * than it first appears. An earlier revision of this check returned
 * `FAILED` — which is wrong on both principle and consequence:
 *
 *  - On principle: "the agent produced no external evidence" is an absence
 *    of proof, not proof of a defect. The claim may well be true. Calling
 *    it FAILED asserts a contradiction this check cannot actually
 *    demonstrate, which is the mirror image of the error this whole
 *    primitive exists to prevent.
 *  - On consequence: `llm-specialist-proposal.ts` materializes every real
 *    model-generated proposal with `authorityRank: "LLM_INFERENCE"` (an
 *    honest label — it IS inference). A FAILED verdict here therefore
 *    denied *every* proposal the LLM specialists could ever produce, making
 *    the entire proposal-first path permanently dead and the verifier
 *    useless: a check nothing can pass filters nothing.
 *
 * `INCONCLUSIVE` is the honest answer — it lets the proposal proceed to the
 * Policy/Risk gate (which applies its own rules) while ensuring the audit
 * trail records that nothing about it was verified. Overclaiming on top of
 * inference-only evidence is still a hard `FAILED`, via the calibration
 * check below — that one IS decidable from the proposal alone.
 */
const selfReferenceCheck: ProposalVerificationCheck = {
  id: "evidence-not-self-referential",
  description: "Evidence is not exclusively the proposing model's own inference.",
  run(proposal) {
    const allInference = proposal.evidence.every(
      (record) => record.authorityRank === "LLM_INFERENCE",
    );
    return allInference
      ? {
          checkId: "evidence-not-self-referential",
          verdict: "INCONCLUSIVE",
          detail:
            "Every evidence record is LLM_INFERENCE — the proposal cites only its own reasoning, so its claims can be neither confirmed nor refuted here.",
        }
      : {
          checkId: "evidence-not-self-referential",
          verdict: "VERIFIED",
          detail: "At least one evidence record originates outside the proposing model.",
        };
  },
};

/**
 * Does any evidence reflect something actually executed or observed?
 *
 * A negative answer is `INCONCLUSIVE`, never `FAILED` — evidence that is
 * merely weak is not evidence that the claim is false. This distinction is
 * the same one `approveMemory()`'s gate draws between `"no_evidence"` and
 * `"unverified_evidence"`.
 */
const authorityCheck: ProposalVerificationCheck = {
  id: "evidence-authority-sufficient",
  description: "At least one evidence record reflects a real execution or observation.",
  run(proposal) {
    const best = bestAuthorityWeight(proposal.evidence);
    return best <= EXECUTED_EVIDENCE_MAX_WEIGHT
      ? {
          checkId: "evidence-authority-sufficient",
          verdict: "VERIFIED",
          detail: "Evidence includes at least one observed/executed source (CI artifact or stronger).",
        }
      : {
          checkId: "evidence-authority-sufficient",
          verdict: "INCONCLUSIVE",
          detail:
            "No evidence reflects an execution or live observation — the claims rest on assertions only, so they can be neither confirmed nor refuted here.",
        };
  },
};

/**
 * Overclaiming check — the difference between "the agent says 90%" and
 * "the agent earned 90%".
 *
 * This is `FAILED`, not `INCONCLUSIVE`, on purpose: asserting high
 * confidence that the proposal's own evidence cannot support is a defect
 * IN the proposal, and it is fully decidable from the proposal itself. The
 * agent is free to propose the same action with honest confidence.
 */
const calibrationCheck: ProposalVerificationCheck = {
  id: "confidence-supported-by-authority",
  description: "Stated confidence does not exceed what the cited evidence can support.",
  run(proposal) {
    const best = bestAuthorityWeight(proposal.evidence);
    const overclaiming =
      proposal.confidence > STRONG_CONFIDENCE_THRESHOLD &&
      best > EXECUTED_EVIDENCE_MAX_WEIGHT;
    return overclaiming
      ? {
          checkId: "confidence-supported-by-authority",
          verdict: "FAILED",
          detail: `Stated confidence ${proposal.confidence} exceeds ${STRONG_CONFIDENCE_THRESHOLD} while the strongest evidence is only an assertion — confidence is claimed, not earned.`,
        }
      : {
          checkId: "confidence-supported-by-authority",
          verdict: "VERIFIED",
          detail: "Stated confidence is consistent with the authority of the cited evidence.",
        };
  },
};

/**
 * The checks that run with no tool runtime and no network. Ordered
 * defect-first so the most serious finding appears earliest in `checks`.
 */
export const DEFAULT_PROPOSAL_CHECKS: readonly ProposalVerificationCheck[] = [
  secretsCheck,
  selfReferenceCheck,
  calibrationCheck,
  authorityCheck,
];

function epistemicStateFor(verdict: ProposalVerificationVerdict): EpistemicState {
  if (verdict === "VERIFIED") return "VERIFIED";
  if (verdict === "FAILED") return "CONTRADICTED";
  return "INSUFFICIENT_EVIDENCE";
}

/**
 * Verify an agent proposal.
 *
 * @param proposal   The proposal to check. Assumed already schema-valid
 *                   (`agentProposalSchema`) — this verifies its substance,
 *                   not its shape.
 * @param additionalChecks Extra checks to run alongside the built-ins —
 *                   the seam for tool-backed verification (run_tests,
 *                   run_typecheck, run_lint) once a Tool Runtime exists.
 *                   Pass `[]` explicitly plus `useDefaults: false` to run
 *                   nothing, which correctly yields `INCONCLUSIVE`.
 */
export function verifyProposal(
  proposal: AgentProposal,
  options?: {
    readonly additionalChecks?: readonly ProposalVerificationCheck[];
    /** Defaults to true. Set false to verify with only `additionalChecks`. */
    readonly useDefaults?: boolean;
  },
): ProposalVerificationResult {
  const checks = [
    ...(options?.useDefaults === false ? [] : DEFAULT_PROPOSAL_CHECKS),
    ...(options?.additionalChecks ?? []),
  ];

  const results = checks.map((check) => check.run(proposal));

  const failed = results.filter((r) => r.verdict === "FAILED");
  const inconclusive = results.filter((r) => r.verdict === "INCONCLUSIVE");

  // A single real defect dominates. Never averaged — see the doc comment.
  if (failed.length > 0) {
    return {
      verdict: "FAILED",
      checks: results,
      rationale: `${failed.length} check(s) found a defect: ${failed.map((f) => f.checkId).join(", ")}.`,
      epistemicState: epistemicStateFor("FAILED"),
    };
  }

  // Absence of a check is never a pass.
  if (results.length === 0) {
    return {
      verdict: "INCONCLUSIVE",
      checks: results,
      rationale:
        "No verification check ran, so nothing about this proposal was established. Absence of a check is not a pass.",
      epistemicState: epistemicStateFor("INCONCLUSIVE"),
    };
  }

  if (inconclusive.length > 0) {
    return {
      verdict: "INCONCLUSIVE",
      checks: results,
      rationale: `${inconclusive.length} check(s) could not reach a conclusion: ${inconclusive.map((i) => i.checkId).join(", ")}. No check found a defect, but that is not the same as verification.`,
      epistemicState: epistemicStateFor("INCONCLUSIVE"),
    };
  }

  return {
    verdict: "VERIFIED",
    checks: results,
    rationale: `All ${results.length} check(s) passed.`,
    epistemicState: epistemicStateFor("VERIFIED"),
  };
}
