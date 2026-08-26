# Atlas work stages (authoritative)

Do not confuse **missing for stability** with **roadmap**.
Do not mark a stage Done without implementation + tests + runtime evidence.
Do not duplicate: `executeGovernedAction`, `dispatchAgentAction`, `executeTool`, `approvals.ts`, `verifyProposal`, `audit-log.ts`.

## 01 BASELINE / FREEZE
Git snapshot + quality-gate evidence of what is actually implemented.

**Status: this freeze documents the tree after stage 02 wiring.** See the
commit message and the gate commands in the session notes. Do not treat
unrun E2E / a11y / turbo as passing.

Honest gaps that remain **outside** stage 02:
- `governed-execution.test.ts`: 7 failed / 5 passed. Failures are
  `RESEARCHER` + `fs.read_file` hitting AUTHORIZATION because the fabric
  catalog does not grant that tool. Catalog/runtime mismatch (stage 10/11),
  not a missing executor. Do not "fix" by adding `fs.read_file` to every agent.
- Control Plane `actorId` default `atlas-owner` on `/api/v1/gateway/ops` is
  stage 03.
- CP in-memory audit is not the canonical NDJSON chain (stage 05).

## 02 GATEWAY COMPLETION ← current (wired; stop before 03)

Connect existing pieces. Control Plane does not run tools.

```
Application → Gateway → Identity → Registries → Capability
→ Entity Policy / Risk (existing) → ALLOW|DENY|APPROVAL
→ executeGovernedAction → executeTool
→ Receipt → Observation → Verification → Audit → Memory
```

**Implemented (code + tests):**
- Registered `applicationId` / `agentId` / capability checks in
  `apps/control-plane/src/services/atlas-gateway.ts`.
- Read ops observe the application registry (`executed` is observation, not
  tool execution). `executed: true` ≠ `verified: true` on the fulfill path.
- Write ALLOW produces `HANDED_OFF_GOVERNED` with a **fabric catalog** tool
  (`analyze_repo` / `propose_patch` / `knowledge_search`), not `fs.read_file`.
- No second Control Plane approval queue on gateway ops. Approval remains
  `apps/api/src/services/approvals.ts`.
- `POST /api/v1/gateway/fulfill` (operator/owner) calls
  `fulfillGatewayHandoff` → `executeGovernedAction` → `executeTool`.
- Successful fulfill appends `agent.run.completed` as `OBSERVED` (not FACT)
  and writes the existing unified audit chain.

**Not claimed:**
- Fabric catalog tools are not all registered in production. Unregistered
  tools fail closed at `executeTool` (`EXECUTION/FAILED`).
- CP `QA_ENGINEER` is not a fabric id; fulfillment DENYs it (stage 10).
- Canonical single audit merge, MFA, identity principals: later stages.

## 03 IDENTITY / AUTHZ
Real principals. No default `atlas-owner` privilege. Customer admin ≠ operator.

## 04 CONTROL PLANE SECURITY
Real MFA, session/token rotation, replay protection, idempotency.

## 05 CANONICAL AUDIT
One hash-chained trail. CP in-memory audit is not a second system of record.

## 06 EXECUTION SAFETY
Timeout, cancel, idempotency, retry safety — on the existing runtime.

## 07 VERIFICATION
`executed: true` ≠ `verified: true`. Verdicts: VERIFIED|FAILED|PARTIAL|INCONCLUSIVE|BLOCKED.

## 08 EGRESS GOVERNANCE
Extend classify→policy beyond the three LLM call sites.

## 09 MEMORY / KNOWLEDGE INTEGRITY
No memory poisoning. FACT vs INFERENCE vs UNVERIFIED.

## 10 AGENT GOVERNANCE
Stabilize existing agents. Delegation never increases authority.

## 11 TOOL GOVERNANCE
Dangerous tools stay behind the existing runtime + policy.

## 12 RELIABILITY
Durable jobs, retries, crash recovery.

## 13 OBSERVABILITY
One correlation ID end-to-end.

## 14 SELF-AUDIT
DEF-000: detect→propose→approve→apply→verify. No self-escalation.

## 15 DISASTER RECOVERY
Backups + restore tests. Before serious production.

## 16 SUPPLY-CHAIN / PRODUCTION SECURITY
Dependencies, secrets, CI permissions, env separation.

## 17 GOVERNANCE TEST SUITE
Invariant tests (unauthenticated DENY, wrong tenant DENY, …).

## 18 PERFORMANCE / SCALE
Only after the security path is stable.

## 19 INTELLIGENCE ROADMAP
Hypothesis engine, golden projects, marketplace, reputation — **not now**.
