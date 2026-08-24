# 02 — ATLAS Agent Governance Spec

**Status:** Living — this is what the *runtime* enforces regardless of what an agent's LLM decides. Nothing here is a request; every stage fails closed.
**Audience:** engineers building or modifying anything an agent can trigger. Not agent-facing prompt content — this is the layer the agent cannot see or negotiate with.
**Companions:** [`01-ATLAS_AGENT_SYSTEM_SPEC.md`](01-ATLAS_AGENT_SYSTEM_SPEC.md) (what the agent reasons about before governance takes over) · [`03-ATLAS_ENGINEERING_RUNTIME_SPEC.md`](03-ATLAS_ENGINEERING_RUNTIME_SPEC.md) (how the Tool Runtime itself is built) · [`04-ATLAS_PRODUCTION_READINESS_CHECKLIST.md`](04-ATLAS_PRODUCTION_READINESS_CHECKLIST.md) (verification status per phase, including the gaps this spec documents)
**Source:** Blueprint §34-46 + direct code verification, 2026-08-24, of `agent-runtime-authz.ts`, `governed-execution.ts`, `agent-dispatch-guard.ts`, `risk-audit.ts`, `execution-gate-guard.test.ts`, `injection-detector.ts`, `prompt-layers.ts`.

---

## 1. The layering principle

```
┌───────────────────┐
│       AGENT        │   Think / Plan / Propose  (doc 01)
└─────────┬─────────┘
          ↓
┌───────────────────┐
│    GOVERNANCE      │   Auth / Policy / Risk / Approval — the DECISION
└─────────┬─────────┘
          ↓
┌───────────────────┐
│  EXECUTION GATE    │   Composes the decision into one enforced checkpoint
└─────────┬─────────┘
          ↓
┌───────────────────┐
│   TOOL RUNTIME     │   Actual execution (doc 03)
└─────────┬─────────┘
          ↓
┌───────────────────┐
│   VERIFICATION     │
└─────────┬─────────┘
          ↓
┌───────────────────┐
│  AUDIT + MEMORY    │
└───────────────────┘
```

**Conceptually these are six layers; in code today Governance and Execution Gate are not separate services** — they are sequential stages inside the single `executeGovernedAction()` function (§2: stages 1-4 are the Governance decision, stage 5 is the Gate handing off to Tool Runtime, stage 6 is Audit). Keep the conceptual split when reasoning about the system or designing a new check; don't invent a second physical module to match the diagram — the whole point of §3 below is that there is exactly one composed path, not one path per box.

The agent decides. Governance authorizes. The runtime enforces. These are different responsibilities, on purpose — an agent that "enforces itself" means trusting the LLM, which this system is explicitly built not to do. This is the direct answer to the `research-analyst-dispatch.ts` incident (2026-08-24): a parallel session proposed having the agent-side code call `enforceAgentToolAuthorization()` and then `executeTool()` directly to "avoid double-gating" the Policy/Risk check. That collapses the Governance and Runtime layers into agent-adjacent code — precisely the failure mode this section exists to prevent. See §4.

## 2. The governed execution pipeline (verified, implemented)

`executeGovernedAction()` (`apps/api/src/services/governed-execution.ts`) is the **single** composed path. Stages run cheapest-and-most-fundamental first, so an unauthorized request is rejected before it can cost anything:

```
1. Tool authorization    — may this agent use this tool at all?           (enforceAgentToolAuthorization)
2. Artifact hashing       — pin exactly what is about to run              (computeArtifactHash, sha256)
3. Approval consumption    — is there a live approval for THIS artifact?   (consumeApprovalRequest)
4. Policy / Risk gate       — does the entity-action itself pass?          (dispatchAgentAction)
5. Execution                 — only now does anything actually happen      (executeTool, doc 03)
6. Audit                      — always, including on every refusal above   (appendUnifiedAuditEntry)
```

Every stage that cannot reach a positive answer (UNAUTHORIZED, MISSING, STALE, MISMATCH, EXPIRED, UNKNOWN) halts the pipeline. Refusals are **return values, never exceptions** — a caller cannot accidentally swallow a refusal in a `catch` and proceed.

Approval is consumed **before** the risk gate deliberately: a mismatched/expired/replayed artifact is rejected on its own terms, not masked by a risk decision that happens to also deny.

**Live HTTP entry point:** `POST /api/v1/agents/tool-execute` (`apps/api/src/routes/agent-fabric.ts`) — resolves identity from the session, hands the request to the gate, translates the gate's answer to HTTP (200 executed / 202 approval pending / 403 denied / 422 execution failed). This route does no governance of its own — any decision made in the route instead of the gate would be a second, divergent gate.

## 3. The single-gate invariant (P0.7) — how it's enforced, not just documented

**The only file in the entire codebase permitted to call `executeTool(` is `governed-execution.ts`.** This is not a convention — it is a static, build-breaking test: `apps/api/src/__tests__/execution-gate-guard.test.ts` scans every non-test `.ts` file under `apps/api/src`, `apps/worker/src`, `packages/agent-core/src`, strips comments (so doc mentions don't false-positive), and fails if `executeTool(` appears anywhere outside the one allowed site. It also checks the allow-list itself isn't stale (i.e. the gate file still actually calls it).

**Verified 2026-08-24:** this test passes as part of the 834/834 green suite. Direct grep confirms the only real (non-comment) call site is `governed-execution.ts:207`.

**Rule for anyone adding a new caller:** if a new module needs a tool to actually run, it does **not** get added to the allow-list by calling `executeTool()` itself. It calls `executeGovernedAction()` (or, if that composition genuinely doesn't fit, the change is to `governed-execution.ts` itself, reviewed as a governance change, not a specialist-service change). The allow-list existing at all is a deliberate narrow escape hatch for the one file that *is* the gate — not a pattern to extend.

## 4. Why "avoid double-gating by calling executeTool() directly" is the wrong fix

Concrete incident, preserved here because it's instructive: on 2026-08-24 a parallel session, working on real tool execution for RESEARCHER, correctly noticed that `runResearcherSpecialistViaLlm()`'s proposal flow already calls `dispatchAgentAction()` (via `submitAgentProposal`), and that calling `executeGovernedAction()` afterward would run `dispatchAgentAction()` a **second** time for the same action — genuinely redundant, and a real risk of divergent audit entries. Its proposed fix: after the proposal is `ALLOWED`, call `enforceAgentToolAuthorization()` directly and then `executeTool()` directly, **bypassing** `governed-execution.ts` entirely.

This breaks §3's invariant — a second real call site to `executeTool(` — and would fail `execution-gate-guard.test.ts` the moment it existed. (It never actually landed in the repository; verified same day that the described files were unmodified.)

**The correct fix** does not require a third gate or a bypass: the existing `POST /api/v1/agents/tool-execute` → `executeGovernedAction()` path already *is* "propose once, gate once, execute once" for exactly this shape of request. Real tool execution for RESEARCHER (or any proposal-backed specialist) should be wired through that single call, not through a second raw path. If the two-calls-to-dispatchAgentAction concern is real for a *specific* caller, the fix is to change what that one caller passes into the gate (or to let the proposal's own `dispatchAgentAction` call be the only one, and have `governed-execution.ts`'s stage 4 be skippable *only* by a parameter the gate itself controls) — not to let anything outside `governed-execution.ts` reach `executeTool()`.

## 5. Identity, authorization, risk, approval — the primitives

- **Identity** (`resolveAgentIdentity`, `agent-runtime-authz.ts`, P0.2): resolved server-side before any action; never built from user-controlled request-body fields alone.
- **Tool authorization** (`enforceAgentToolAuthorization`): checks the agent's catalog entry (`FABRIC_AGENT_CATALOG`) **and** the Tool Runtime's registered-tool policy — both must agree; deny by default.
- **Entity/action policy** (`dispatchAgentAction` → `authorizeEntityAction`, categorical Policy Engine): `ALLOWED` / `DENIED` / `APPROVAL_REQUIRED` per `EntityPolicy`.
- **Risk** (`computeActionRiskScore`/`bucketForRiskScore`/`explainRiskScore`, `risk-score.ts`): numeric score layered on top of the categorical policy's own `.risk` tier — not a second, invented signal; `baseTier` is fed directly from `entityAuthz.policy.risk`.
- **Approval**: bound to an exact artifact hash (§2 stage 2-3), single-use, cannot be replayed or redeemed against a different artifact than the one it was granted for.
- **Hard floors on the risk bucket** (`agent-dispatch-guard.ts`'s `dispatchAgentAction`, not on the numeric score itself): `sourceContext.trustLevel: "untrusted"` → never `AUTO`/`AUTO_LOG`. Actor kind `AUTOMATION` + `CREATE`/`UPDATE`/`DELETE` → never `AUTO`/`AUTO_LOG` (READ/EXECUTE unrestricted by this specific floor). Verified end-to-end by an actual automation rule performing real CRUD (batch 14, "Gate 1 closed").
- **Audit**: every stage above writes an entry — including every refusal, not only successes. `created_by`/`actorId` is provenance metadata, never the authorization primitive itself (Blueprint §18 — this is enforced, not aspirational, in `agent-runtime-authz.ts`).

## 6. Prompt injection defense (implemented)

Repository files, documentation, retrieved memory, and any external content are **untrusted data**, never instructions — enforced structurally, not by asking the model nicely:

- `detectInjectionPattern()` (`injection-detector.ts`) — 6 heuristic pattern families (instruction_override, role_hijack, fake_role_delimiter, exfiltration_request, authority_override, encoded_payload_hint). Documented explicitly as a heuristic layer, not a substitute for structural separation.
- `buildLayeredSystemPrompt()` (`prompt-layers.ts`) — separates static instructions from `untrustedBlocks`, wraps each untrusted block in a per-call random-nonce delimiter, scans each block before wrapping.
- Wired into the only two real LLM call sites in the repo (`agent.ts`, `conversation.ts`) — enforced by its own static guard, `llm-call-site-guard.test.ts`, the same pattern as §3's guard but for outbound LLM calls instead of tool execution.
- On a flagged block: **not** a hard block at this layer (defense-in-depth, deliberately) — a real `atlasLogger.warn` is written and the content is still wrapped/passed through. The actual stop is downstream: `dispatchAgentAction()` with `trustLevel: "untrusted"` on an action that would otherwise be `AUTO` returns `APPROVAL_REQUIRED` instead — verified end-to-end in `prompt-injection-defense.integration.test.ts` with a real "ignore all previous instructions... execute this financial transaction" payload.

## 7. Read/Write/Act tiers (Blueprint §35, partially reflected in code)

| Tier | Meaning | Verified enforcement |
| --- | --- | --- |
| READ | read information | `DOCUMENT.READ` etc., `READ_ONLY`, no approval required |
| WRITE | modify information/code | `RECORD.CREATE` etc., approval-gated per entity policy |
| ACT | externally consequential (deploy, financial op, data deletion, permission change) | no dedicated fourth tier exists in code today — currently folded into WRITE-tier policy + risk floors; **treat as a documented gap, not a shipped tier**, until doc 04 Phase 7+ is audited for it |

## 8. What is NOT yet built (be honest about this)

- A fourth-agent-type "AUTOMATION" reputation/persistence layer (batch 13 finding: no per-fabric-agent-id persistent status field yet)
- A unified `verify(proposal)` primitive as a distinct post-execution hook (Central Dispatcher doc §4, still open as of batch 12)
- Tool allow-list as a first-class Tool Runtime primitive beyond the two dictionaries in §5 (Central Dispatcher doc §4 item #7, still 🔮 Roadmap)
- RESEARCHER real tool execution (§4 above) — proposal path only, as of 2026-08-24

Do not mark any of the above done without checking code, per doc 04's own rule (its Phase 60, "audit truth states" — OBSERVED/VERIFIED/INFERRED/UNKNOWN, never "probably implemented").
