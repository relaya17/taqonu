# ATLAS — Full Gap Analysis & Staged Roadmap
Version: 2026-08-19, Revision 2 / Stage 2 (source-of-truth revision, every codebase claim verified this session; Revision 2 folds in the detailed follow-up roadmap you pasted — same evidence, reorganized into build tracks and a full dependency chain, per "אני רוצה הכל להעביר למסמך... אני רוצה לשאוף הכי גבוה — פערים טכנולוגיים אלה כן אפשר לבנות")

---

## 0. How to read this document

This is the master gap list requested: "צור רשימה מכל כל החסרים שיש באפלקציה, נבנה את זה בשלבים והמסמך יתעדכן." It synthesizes the full "Atlas AI-Native Professional OS" vision (SDK, Agent Fabric, Tool Runtime, Sandbox, Knowledge Fusion, External Intelligence, Engineering Graph, Change Intelligence, Verification Engine, Confidence/Reputation, Explainability, Diagnosis/Prediction, Self-Healing, Professional Work OS, Universal Inbox, Multi-App Intelligence, Security-by-Architecture, SDK "Bring Your Own AI") against what actually exists in the codebase today. Every line below was checked against real files this session — not inferred from the vision documents.

Five tags, used consistently:

- ✅ **Implemented** — real, working code, verified.
- 🟡 **Partial** — the mechanism exists but is narrower / scattered / not fully wired.
- ❌ **Missing** — an engineering-hygiene gap (reliability/ops pattern), not a "vision" capability — should exist regardless of the bigger roadmap.
- 🔮 **Roadmap** — a vision capability with no existing implementation to build from.
- 🟢 **Target** — used in §16/§25/§26 to mark where a 🟡/❌/🔮 item is meant to land once its build phase completes. 🟢 is never a claim about today's code — only ✅ is.

This document will be updated stage by stage as work lands (per your instruction — "נבנה את זה בשלבים והמסמך יתעדכן").

---

## 0.1 Three build tracks

Your latest message drew a distinction that matters enough to structure the whole document around: not every gap below is the same *kind* of gap. Some are things I can write code for this week. Others are not code gaps at all — no amount of engineering effort in this sandbox closes them. Splitting these into three tracks keeps that honest:

- **Track A — Build Now (technology gaps, closeable in code).** §2, §3 (Tool Runtime + Sandbox), §4, §5, §6, §7, §8, §9, §14, §15, §18 (Evaluation at Scale), §19 (reliability hygiene). This is where "aim high" applies — these are the gaps this document targets 🟢 on.
- **Track B — Enterprise Hardening (mostly code + process, but certification-shaped, not feature-shaped).** §13 (security-by-architecture), §20 (SSO/SAML/SCIM/compliance), §21 (ecosystem/integrations), §22 (production HA/SLA). Real engineering work, but scoped by audits, certifications, and breadth of integration surface rather than by a single well-defined feature.
- **Track C — Company Scale (not a code gap at all).** §23 (distribution/customers), §24 (capital/team). Listed here for completeness because your message asked for "the whole thing" in one document, but no section of this document should ever imply these can be closed by writing code. They're what Seed capital is for, not what a sprint is for.

§25 gives the full three-track table; §26 gives the detailed 14-node dependency chain within Track A + the Track A/B boundary.

---

## 1. Entity model / "Atlas SDK" primitives

The vision names 19 primitives an SDK contract should define. Here is what's real in `packages/shared` today:

| Primitive | Status | Evidence |
|---|---|---|
| Organization | ❌ Missing | No schema/type anywhere. Only appears as a free-text field name in `knowledge-source.schema.ts`/`benchmark.schema.ts`. |
| Tenant | ❌ Missing | No schema/type. "Tenant" is informal shorthand in comments for `ownerId`. |
| Project | ✅ Implemented | `schemas/project.schema.ts` — `projectSchema`/`createProjectSchema`. **This is the effective top-level tenant unit today** — see below. |
| Application | ❌ Missing | No schema/type at all. |
| Agent | 🟡 Partial | `schemas/agent-fabric.schema.ts:fabricAgentPublicSchema` + `constants/agents.ts:FABRIC_AGENT_CATALOG` — scoped to the fabric catalog, no general org/tenant-scoped Agent entity. |
| Capability | 🟡 Partial | `schemas/auth.schema.ts:authCapabilitySchema` (RBAC) and `schemas/plugin-manifest.schema.ts` (plugin capabilities) — two disjoint definitions, no unified concept. |
| Tool | ✅ Implemented | `schemas/tool-policy.schema.ts:toolPolicySchema`, `constants/tools.ts:TOOL_RISKS`. |
| Resource | ❌ Missing | No schema/type. |
| Action | 🟡 Partial | `constants/actions.ts:ACTION_KINDS` + `unifiedAuditEntrySchema.action` — no standalone Action entity. |
| Policy | 🟡 Partial | Only `toolPolicySchema` (tool-scoped). No general Policy entity — the categorical Policy Engine (`authorizeEntityAction`) is code logic, not a persisted schema. |
| Risk | 🟡 Partial | Scattered enums (`TOOL_RISKS`, `auditRiskLevelSchema`, inline `riskLevel` in agent-fabric) — no single canonical Risk type. |
| Approval | ✅ Implemented | `schemas/approval-request.schema.ts:approvalRequestSchema`. |
| Evidence | ✅ Implemented | `schemas/evidence.schema.ts:evidenceRecordSchema`, `claimSchema`. |
| Memory | ✅ Implemented | `schemas/memory.schema.ts:memorySchema` — 12 types, source/provenance fields (see §4). |
| Event | ✅ Implemented | `schemas/domain-event.schema.ts:domainEventSchema` — has `ownerId`+`projectId`, no `orgId`. |
| Execution | 🟡 Partial | `schemas/agent-run.schema.ts:agentRunSchema` is the de-facto execution record; nothing literally named "Execution". |
| Outcome | ❌ Missing | No schema named Outcome — only status enums (`agentRunStatusSchema`, `auditResultStatusSchema`). |
| Verification | ✅ Implemented (as a schema) / 🟡 Partial (as an engine — see §6) | `schemas/evidence.schema.ts:verificationMatrixSchema`, `schemas/verdict.schema.ts:atlasVerdictSchema`. |
| Audit | ✅ Implemented | `schemas/unified-audit-entry.schema.ts:unifiedAuditEntrySchema` — hash-chained (see §13). |

**Organization/Tenant — the single most important structural finding**: there is no Organization entity above Project anywhere in the codebase. `project-access.ts` confirms this operationally — ownership is a flat `Record<projectId, ownerId>` map bound to one user id; `role === "admin"` is the only bypass. **Project is the top-level tenant unit today.** Any "Multi-Application Intelligence" or "cross-project, org-scoped consent" vision item is blocked on this not existing yet — it would need a real Organization/membership model first, not just a policy flag.

---

## 2. Agent Fabric core

| Capability | Status | Evidence |
|---|---|---|
| Multi-provider LLM abstraction | ✅ Implemented | `packages/agent-core/src/providers/llm.ts` — real `AnthropicProvider`, `GeminiProvider`, `OpenAiCompatibleProvider` (OpenAI/Groq/DeepSeek/Ollama), real HTTP calls, real usage-based cost computation, free `ContextEchoProvider` fallback. Wired into the chat/companion endpoint (`routes/agent.ts`, `conversation.ts`). |
| Model Router | ✅ Implemented (task-tier, not literal best-model-per-task) | `packages/agent-core/src/router/genius.ts:geniusRoute` — routes by task-complexity tier (cheap/strong/vision/local), with real cost/error-rate demotion from rolling stats (`recordModelCall`). |
| Agent Registry / identity | ✅ Implemented, vendor-neutral by design | `constants/agents.ts:FabricAgentDefinition` has no model/vendor field at all — identity is capability-based (allowedTools, riskLevel, canWriteCode). `registry-lifecycle.ts` adds enable/disable overlay (in-memory, not persisted across replicas). |
| **Specialist dispatch actually calling a model** | 🟡 **Partial — this is the core gap** | `packages/agent-core/src/orchestrator/dispatch.ts:runSpecialistStub` is the default path for every specialist, explicitly commented "not a chat model" — never calls an LLM. Only 2 specialists have real overrides (`SECURITY`→static scanner via Sentinel, `LEGAL_MEDIA_COMMS`), neither calls the LLM providers above. `cost-intelligence.ts` documents costs as $0 "until a specialist path is wired." **The only route that makes a real LLM call today is the general chat companion — not the specialist fabric.** |

---

## 3. Tool Runtime / Sandbox — Track A, Target 🟢

❌ **Missing entirely, today.** No sandboxed code-execution or general tool-calling primitive exists anywhere. "Agent execution" today means calling a specific internal service function directly (e.g. the security scanner). No `read_file`/`write_patch`/`run_tests`-style capability-scoped tool contract exists yet. This is the single largest capability gap vs. OpenAI's Agents SDK. Per your instruction, Sandbox is **not treated as a separate product** — it's a maturity level inside this same Tool Runtime, not a parallel roadmap item.

**Target tool set** (small, explicit, allow-listed — not "arbitrary code execution"):

```
read_file · search_repo · read_directory · write_patch
run_tests · run_typecheck · run_lint · inspect_project
inspect_db · build · deploy_staging
```

**Target call pipeline — every tool call, no exceptions:**

```
Agent → Identity → Policy → Risk → Tool Permission → Execution → Audit → Verification
```

Every tool call carries: `agentId`, `tenantId`/`projectId`, `capability`, `policy`, `risk`, `timeout`, `resource limits`, `audit context`. **The control primitive to reuse is `enforceEntityWrite`** (`apps/api/src/services/risk-audit.ts`, already live in 32+ routes) — extended from an HTTP-route gate into a Tool Runtime gate. This is a hard constraint, not a suggestion: do **not** invent a parallel `toolPolicy2`/`agentGuard3` — the anti-bypass property this whole document keeps citing (§15) only holds if every write path, HTTP or tool-call, shares the exact same gate.

**Staged maturity — Sandbox folded into Tool Runtime, not separate:**

- **Phase 2A — Allow-listed tools.** The 11 tools above, each gated by the pipeline above, running in-process (no isolation yet beyond the policy/risk/audit gate itself). This alone is what makes "Atlas agents do real work" true for the first time.
- **Phase 2B — Isolated execution.** Ephemeral workspace per run, filesystem isolation, process isolation.
- **Phase 2C — Full sandbox.** Network policy, CPU/RAM/time quotas, secret isolation, snapshot/rollback — the complete isolated-execution environment described in your message:

```
Agent → Ephemeral Workspace → Filesystem Isolation → Process Isolation
      → Network Policy → CPU/RAM/Time Limits → Secret Isolation → Snapshot/Rollback
```

Building 2A before 2B/2C is deliberate: a real, gated, narrow tool set with no sandbox yet is a smaller, shippable, testable milestone than a full sandbox with nothing to run in it — and 2A is what turns Phase 1 (real specialist LLM calls) into agents that can actually act, not just talk.

---

## 4. Knowledge & Memory

| Capability | Status | Evidence |
|---|---|---|
| Memory schema (12 types) + provenance | ✅ Implemented | `memory.schema.ts` — `source`, `sourceType` (8 values), `evidence[]`, `epistemicState`, `validFrom/validUntil`, `verifiedBy/verifiedAt`, plus `SOURCE_TRUST_CEILING` capping which epistemic states each source type may self-assert. |
| Memory retrieval | 🟡 Partial — **keyword/field filtering, not semantic** | `memory-pipeline.ts:retrieveMemories` filters by `projectId`/`status`/`visibility`, scores by confidence+epistemicState+priority+recency, and does a plain substring check on the query — **no embeddings call**. |
| Real embeddings + vector similarity | ✅ Implemented, but scoped elsewhere | `packages/embeddings/src/provider.ts` — genuine (if simple, local, hash-trick) embedding + real cosine-similarity math. **Live-wired**, but only into `packages/knowledge`'s separate corpus via `hybrid-rag.ts` (used by `agent-fabric.ts`, `agent.ts`, `kernel.ts`, `conversation.ts`) — **not connected to the 12-type Memory system at all.** Closing this gap (wiring Memory retrieval through the existing embeddings package) is a well-scoped, buildable-now task — the pieces already exist, they're just not connected to each other. |
| Contradiction Engine | ✅ Implemented | `routes/conflicts.ts` — real `CONFLICTED` epistemic-state detection between claims, with `compareSourceAuthority` ranking suggestion. |
| Verified Knowledge Engine (External Knowledge Registry) | 🟡 Partial | `verified-knowledge-refresh.ts` + `constants/official-knowledge.ts` — hard allow-listed sources only, tracks `contentHash`/`fetchedAt`/24h refresh-due ledger. **No license/rights-owner field, no human sign-off gate before ingest.** |
| Legal/rights tracking for ingested content | 🟡 Partial | `constants/legal-media-sources.ts:VERIFIED_LEGAL_MEDIA_SOURCES` — `id`/`kind`/`region`/`url`/`topics`. **No `license` or `rightsOwner` field** — it's a citation allow-list, not a rights ledger. Confirms your own instinct: don't build a separate "books/experts" ingestion pipeline — extend this proven allow-list pattern instead, and get real legal review before touching licensed content. |

---

## 5. Engineering / System Graph + Change Intelligence

| Capability | Status | Evidence |
|---|---|---|
| Graph node types | ✅ Broader than pure code structure | `constants/graph.ts:GRAPH_NODE_TYPES` — 18 types including `PACKAGE`, `TEST`, `DECISION`, `DEPLOYMENT`, `INCIDENT`, `IDENTITY`, `DATA_STORE`, `EVIDENCE`, `MEMORY`. **No `AGENT` node type, no `POLICY` node type.** |
| Blast radius / impact query | ✅ Implemented, but undifferentiated | `computeGraphImpact` (`packages/observer/src/graph/build.ts`) — real BFS traversal, returns `{nodes, edges, epistemicState}`. Does **not** separate "policy impact"/"security impact"/"agent impact"/"test impact" as distinct outputs — that's whatever node types happen to fall out of the traversal. |
| Composed "Change Intelligence" pipeline (diff → dependencies → blast radius → policy/security/agent/test impact → risk) | 🔮 Roadmap | No `changeImpact`/`impactAnalysis` pipeline exists anywhere. Closest is `runObserveCycle` — a real composed pipeline (graph→deploy events→Sentinel scan→security policy findings→risk score), but it operates on the **whole repo snapshot each run**, not a specific diff/patch as input. |
| Live/incremental graph updates | ❌ Missing | One-shot rebuild only (`POST /graph/rebuild`), full re-parse from scratch each time (capped at 120 sample files), no watchers/webhooks/incremental diffing. |

---

## 6. Verification Engine

🟡 **Real but scattered — no unified engine.** Every feature owns its own narrow verification logic; none run an actual test suite or static-analysis tool (no `execSync`/`spawnSync` found anywhere in the verification paths):

- Patch apply (`auto-remediation.ts:verifyRemediationApply`) — checks file exists + contains an issue-ID/marker string; for `TRUTH_FIX:` patches, re-runs Observer and checks the finding disappeared (a re-scan diff, not a test run).
- Security findings (`observer/security/verify.ts:verifySentinelFinding`) — re-runs the scanner, checks the finding is gone, "basic" vs "strong" tiers.
- Agent responses (`agent-core/verifier/self-check.ts`) — validates a boolean checklist the *caller* already supplied; performs no independent check itself.
- QA runs — heuristic regex/pattern scanners, no pass/fail verdict against a proposal at all.
- Readiness certificate — pure evidence-aggregation (regex-grep + gate-graph + evidence counts), explicitly disclaims being "live production proof."

There is no shared `verify(proposal) → Verified/Failed/Inconclusive` primitive. Building one — reusable across patch-apply, QA, and (once real) specialist dispatch — is a concrete, well-scoped next step, and a prerequisite for Diagnosis/Prediction ever having real ground-truth data to learn from.

---

## 7. Confidence Calibration + Agent Reputation

❌ **Missing, confirmed.** `risk-score.ts` treats `confidence` as a static caller-supplied float (default 0.5) — no code anywhere computes it from historical accuracy. `registry-lifecycle.ts` tracks only a boolean enabled/disabled toggle per agent — no success/regression/rollback rate anywhere in the repo. As discussed: this doesn't need real specialist-LLM dispatch to start — real outcome signals already exist today in patch apply/rollback results and human approval/override decisions. This is genuinely buildable now, as one project (per your own read of it).

---

## 8. Explainability

🟡 **Partial — real data, not surfaced.** `risk-score.ts:explainRiskScore` produces a real `{score, bucket, factors[]}` breakdown, used internally by `risk-audit.ts` and `code.ts`. It's written into audit-log `reason` text and approval-request `reason` text, but **no API response returns the structured factor list as its own object** — only human-readable text buried in audit/approval records. Small, well-scoped fix.

---

## 9. Cost Intelligence

🟡 **Partial.** `cost-intelligence.ts` aggregates real `agents.dispatch` audit entries into `byProject`/`byAgent` breakdowns. No per-task or per-customer breakdown. Per its own code comments, `costUsd` is $0 in practice for most paths today — a direct consequence of the specialist-dispatch stub gap in §2, not a bug in cost-intelligence.ts itself.

---

## 10. Diagnosis, Prediction, Simulation, Self-Healing

🔮 **Roadmap — explicitly, by your own decision on 2026-08-19.** No existing model/algorithm for root-cause reasoning, failure forecasting, or business-consequence simulation exists anywhere in the code. Per your instruction, these stay tagged 🔮 in the main positioning doc, each with real acceptance criteria (see the "Prediction" example format you proposed) rather than being described as in-progress. They correctly depend on §2 (real specialist actions), §6 (a real Verification Engine), and §7 (Confidence/Reputation) producing real historical data first — building them earlier would produce decoration, not intelligence, exactly as you identified.

---

## 11. Professional Work OS / Universal Inbox / AI Chief of Staff

| Capability | Status | Evidence |
|---|---|---|
| Daily Brief / Morning Digest | ✅ Implemented | `admin-oracle-digest.ts` — real `OracleDailyBrief`/`OracleMorningDigest`. |
| Cross-cutting priority queue | 🟡 Partial | `admin-oracle-queue.ts:buildOracleActionQueue` genuinely merges **6 sources** (watchdog alerts, patch drafts, failed deploys, version instability, CVE matches, Sentinel posture) into one ranked list — real aggregation, not a stub. **But it excludes approvals, QA findings, and cost anomalies**, which each remain fully siloed in their own route/panel. |
| Unified "what needs my attention" UI | 🟡 Partial | The admin Command Center (`apps/web/app/admin/page.tsx`) is a tab strip — Approval Queue, AI Costs, QA all render in isolation per-tab, no merged cross-tab ranking. |

Closing this gap is mechanical, not novel: extend `buildOracleActionQueue` to also pull from `approvals.ts`, `qa.ts`, and `cost-intelligence.ts`'s anomaly detector — the aggregation pattern to copy already exists in the same file.

---

## 12. Multi-Application / Cross-Org Intelligence

🔮 **Roadmap — correctly gated, per your own instinct.** Blocked structurally on §1 (no Organization entity exists yet — Project is the top-level tenant unit). Building "Atlas sees relationships across HotelOS/BrokerOS" before an explicit org-level consent model exists would directly reproduce the cross-tenant leaks fixed earlier this session (evalSuites, proof/status, GitHub installations). **Do not start this before an Organization/consent schema exists.**

---

## 13. Security-by-architecture (16-point check)

| # | Property | Status | Evidence |
|---|---|---|---|
| 1 | Tenant isolation | 🟡 Partial | Real owner-match checks (`resource-access.ts`, `project-access.ts`), but system/webhook-created records use a shared `STUB_OWNER_ID` — code comment admits "not genuinely tenant-scoped yet." |
| 2 | Least privilege / capabilities | ✅ Implemented | `capabilitiesForRole(role)` — per-capability grants, not just admin/user. |
| 3 | Signed identity | 🟡 Partial | HMAC-signed state tokens exist for the GitHub install flow only; regular user identity is standard Supabase JWT session auth. |
| 4 | Secrets isolation | ✅ Implemented | `redactSecrets()` + `SECRET_PATTERNS` (`agent-core/secrets/detector.ts`). |
| 5 | Audit-everything, tamper-evident | ✅ Implemented | Hash-chained (`prevHash`/`hash` = sha256, genesis sentinel) — `audit-log.ts`. |
| 6 | Immutable evidence | ✅ Implemented | `evidence.ts` route registers only GET/POST, no PUT/PATCH/DELETE. |
| 7 | Idempotent automation | 🟡 Partial | Real idempotency-key guard for Stripe webhooks only (`stripe.ts`) — no equivalent in patch-apply/automation-engine. |
| 8 | Event dedup (webhooks) | ❌ Missing | GitHub webhooks verify HMAC signature only, no delivery-id dedup check. |
| 9 | Rate limiting | ✅ Implemented | `@fastify/rate-limit` global + dedicated auth-route limiter. |
| 10 | Timeouts | ✅ Implemented | `AbortController` + explicit timeouts on all LLM provider calls. |
| 11 | Circuit breakers | ❌ Missing | Only exists as a detector regex that scans *other* code for this pattern — no real breaker anywhere in api/agent-core/shared. |
| 12 | Backpressure | ❌ Missing | No concurrency-limit/queue implementation found. |
| 13 | Retries | ❌ Missing | Detector regex exists; no actual retry-with-backoff loop around LLM/fetch calls — timeout+abort only. |
| 14 | Rollback | ✅ Implemented | `POST /code/patches/:id/rollback`, gated by risk-score/approval. |
| 15 | Observability | ✅ Implemented, broad | `atlasLogger`/`atlasMetrics` used across 69 call sites in 17 files. |
| 16 | "Zero Trust" as a distinct pattern | ❌ Missing (as a label) | No such explicit pattern — what exists is solid conventional session-auth + per-route capability guards, not a labeled Zero Trust architecture. Don't claim this term without the actual pattern behind it. |

Three genuine, scoped ops-hygiene gaps worth a small dedicated pass regardless of the bigger roadmap: **circuit breakers, backpressure, and retry-with-backoff** on the LLM provider calls in `llm.ts` — these matter more once §2's stub gap closes and real LLM traffic starts flowing.

---

## 14. SDK "Bring Your Own AI" positioning

✅ **Already true architecturally**, per §2 — `FabricAgentDefinition` has no model/vendor field, and 3 real providers already exist behind `LlmProvider`. This is a genuinely strong, code-backed differentiator, not aspirational.

---

## 15. Anti-bypass control path ("every agent action must go through Policy → Risk → Audit")

Not yet testable end-to-end, because there is no real tool-execution path for it to apply to (§3 is missing). The pattern to require, once Tool Runtime exists, already has a proven template in this exact codebase: `enforceEntityWrite` (built this session, now used in 32+ routes) is precisely the "no route calls a mutation without going through Policy+Risk+Audit" discipline this item is asking for — extend that same discipline to tool calls rather than inventing a new gate.

---

## 16. Staged build order

This is the order that follows from the dependency chain surfaced above, not a re-ranking of preferences:

**Phase 1 — Agent Reality.** Take 2–3 specialists off `runSpecialistStub` and route them through the real `geniusRoute`→`LlmProvider` path, gated by `enforceEntityWrite` end-to-end, with real verification (§6) and a real audit/memory write on completion. This is the one change that makes every other "Atlas governs real AI agent actions" claim true instead of partially true. *Environment note: no LLM provider API keys (Anthropic/Gemini/OpenAI) are configured in this sandbox — the wiring, tests (with a mocked provider, same pattern already used elsewhere), and policy/risk/audit integration can all be built and verified here; a live end-to-end call needs real credentials, which is a deployment-environment step, not a code gap.*

**Phase 2 — Controlled Tool Runtime.** A small, explicit allow-listed tool set (`read_file`, `search_repo`, `write_patch`, `run_tests`, `run_typecheck`, `run_lint`) each carrying identity/tenant/project/permission/risk/timeout/audit — reusing `enforceEntityWrite`'s pattern, not a new gate (§15).

**Phase 3 — Learn From Outcomes.** Confidence Calibration + Agent Reputation (§7) — can start now against existing patch/approval outcome data, gets richer once Phase 1 produces real specialist outcomes too.

**Phase 4 — External Intelligence.** Extend the existing Verified Knowledge Engine (§4) — CVE/standards/documentation matching against customer systems — reusing the allow-list pattern, not a new ingestion pipeline, and with real legal review before adding any licensed source.

**Phase 5 — Diagnosis + Prediction.** Only once Phases 1–3 are producing real historical data to learn from (§10).

**Phase 6 — Controlled Autonomous Engineering / Self-Healing.** Depends on Phase 2 (real tool execution) + Phase 5 (real diagnosis) existing first.

**Phase 2.5 — Reliability hygiene, folded in once Phase 1 goes live.** Not a numbered phase of its own because it's small, but sequencing matters: retry-with-backoff, circuit breakers, and backpressure/concurrency limiting (§13, items 11–13, currently ❌) become load-bearing the moment §2's specialists start making real outbound LLM calls instead of returning stubs — a flaky provider or a burst of concurrent agent calls has no blast-radius control today. Land this alongside Phase 1, not after it.

§26 below restates this same order as a full 14-node dependency chain (matching the more granular breakdown you sent), with two hard sequencing rules called out explicitly.

---

## 17. What's already stronger than the vision documents assumed

Worth saying plainly, because it changes the pitch: Contradiction Engine, Blast Radius, Engineering Health Score, Daily Brief/Digest, a 6-source cross-cutting priority queue, real multi-provider LLM abstraction with a real task router, and a genuinely vendor-neutral agent identity model are **all real, working code today** — not vision. The gap between "Atlas has governance infrastructure" and "Atlas visibly governs real autonomous work" is narrower and more specific than the original brainstorm suggested: it is almost entirely Phase 1 (§2) and Phase 2 (§3) above. Everything past that (Confidence, Reputation, External Intelligence, Diagnosis, Prediction) is a natural extension of infrastructure that already exists, not a separate bet.

---

## 18. Evaluation at Scale (Agent Evaluation Platform) — Track A, Target 🟢

🟡 **Partial today.** Real evaluation/QA infrastructure exists (`atlasEvalSuiteRunSchema`, `regressionReportSchema`, `runBenchmarkSuite`/`compareSuiteRuns` in `packages/engineering-loop`, plus the QA route's heuristic scanners) — but it evaluates *suites/benchmarks*, not individual agent task outcomes over time. There is no per-agent, per-task evaluation ledger yet.

**Target shape**, per task, per agent:

```
Task → Expected Outcome → Actual Outcome → Evidence → Tests → Score → Regression → Historical Performance
```

From that ledger, these become computable — not invented metrics, but real aggregates over real outcome records:

- accuracy
- success rate
- regression rate
- rollback rate
- policy violation rate
- cost per successful task
- latency
- human override rate

**This is not a standalone feature — it's the direct data source for §7 (Confidence Calibration + Agent Reputation).** Confidence Calibration needs `prediction → outcome → verification → historical accuracy`; Agent Reputation needs `success/regression/rollback/override rate` per agent. Build the evaluation ledger first (or alongside §7); Confidence/Reputation is a read model over it, not a separate data-collection effort. It also depends on §6 (Unified Verification) for the "Actual Outcome" step to mean something consistent across patch-apply, QA, and (once real) specialist dispatch, rather than each producer reporting its own ad-hoc pass/fail shape.

---

## 19. Reliability hygiene as Phase 2.5 — Track A, Target 🟢

Restated here as its own numbered section because it's easy to deprioritize as "not exciting" and that would be a mistake. Already identified in §13 as items 8, 11, 12, 13 (❌ Missing):

- **Retry with backoff** on LLM/network calls — currently only `AbortController` timeouts exist, no retry loop.
- **Circuit breakers** — currently exist only as a *detector regex* that scans other code for the pattern; no real breaker exists anywhere in `api`/`agent-core`/`shared`.
- **Backpressure / concurrency control** — no concurrency-limit or queue implementation found; nothing stops a burst of agent calls from overwhelming the system.
- **Event dedup on webhooks** — GitHub webhooks verify HMAC signature only, no delivery-id dedup.

None of these are exotic. All four are small, well-understood patterns. The reason they matter *now* rather than as generic hardening: they become load-bearing the moment §2's specialists make real outbound LLM calls instead of returning `runSpecialistStub`'s stub. Land this alongside Phase 1/Phase 2A, not deferred to a later "hardening sprint."

---

## 20. Enterprise Security / Compliance — Track B

🟡 **Partial, and the framing matters.** This is not "the system is insecure" — §13's 16-point audit shows a genuinely solid security foundation (hash-chained audit log, secrets redaction, least-privilege capabilities, immutable evidence, rate limiting, rollback). The gap is specifically between *"a system with good security architecture"* and *"a system a CISO/procurement team can formally approve."* That's a certification-and-process gap, not a code-quality gap:

```
SSO / SAML · SCIM · Enterprise RBAC · Secrets Management / KMS
Encryption at Rest / in Transit · Key Management
Data Retention · Data Residency
SOC 2 · ISO 27001
Incident Response · Backup / DR
Security Policies · Penetration Testing
```

None of this exists today (confirmed: no SAML/SCIM library or config anywhere in `apps/api`; auth is standard Supabase session JWT per §13 item 3). This should be scoped as its own workstream once Track A's Phase 1–3 are live — building enterprise compliance around agent actions that don't exist yet is backwards.

---

## 21. Ecosystem / Integrations — Track B

🟡 **Partial, and this is a breadth gap, not a depth gap.** Today's integration surface is narrow and specific: GitHub App install flow, Stripe webhooks, Supabase. The target surface for a "universal professional work OS" is wide:

```
GitHub · GitLab · Bitbucket · Jira · Linear · Slack · Teams
Google Workspace · Microsoft 365 · AWS · Azure · GCP
PostgreSQL · MongoDB · Redis · Sentry · Datadog · CI/CD
```

**The SDK is the leverage point here, not hand-written connectors.** The vendor-neutral agent/tool architecture already confirmed in §2/§14/§3 (`FabricAgentDefinition` with no vendor field, `enforceEntityWrite` as a reusable gate) is exactly the shape that supports "build the connector contract once, integrate everywhere" rather than 20 bespoke one-off integrations each with their own auth/policy/audit logic. Nothing here needs to ship on day one — the sequencing point is: get the SDK/connector *contract* right during Phase 2 (Tool Runtime), because retrofitting it after 5 bespoke integrations exist is much more expensive than designing it in from the first one.

---

## 22. Production HA / SLA — Track B/C boundary

🔮 **Roadmap, and correctly so before there's production traffic to justify it.**

```
Multi-region · High Availability · Failover · Durable queues
Backups · Disaster Recovery · RPO/RTO
Load testing · Capacity planning · Monitoring · On-call · SLA
```

None of this exists today, and it shouldn't be built speculatively — over-investing in multi-region HA before there's a single production customer is a real anti-pattern, not just a nice-to-have skipped. Sequencing, in order: (1) single-region production with the observability already confirmed real in §13 item 15, (2) HA + backup + DR once there's something worth protecting, (3) multi-region + contractual SLA once a customer's contract actually requires it. Don't front-load this.

---

## 23. Distribution / Customers — Track C, not a code gap

🔮 **Roadmap — and explicitly not something this document, or any amount of engineering in this sandbox, can close.** OpenAI/Microsoft/Google's advantage here is millions of users, enterprise relationships, sales organizations, partner ecosystems, and cloud distribution — built over years, not sprints. Listed here only so the document is honest about what "closing every gap" would actually require, per your instruction to include everything. No further breakdown is useful because there's no file:line evidence to check — this isn't a codebase question.

---

## 24. Capital / Team — Track C, not a code gap

🔮 **Roadmap — same caveat as §23.** Reaching enterprise scale eventually needs dedicated CTO/architecture, backend, frontend, AI, security, platform, DevOps/SRE, QA, product, enterprise sales, customer success, and legal/compliance functions. Not needed all at once, and not needed before Track A closes — but real, and not a code gap either.

---

## 25. The three tracks, in one table

| Track | What it is | Sections | Closeable by writing code? |
|---|---|---|---|
| **A — Build Now** | Real agent execution, tool runtime, sandbox, evaluation, learning-from-outcomes | §2, §3, §4, §5, §6, §7, §8, §9, §14, §15, §18, §19 | **Yes** — this is where "aim high" belongs |
| **B — Enterprise Hardening** | Certification, compliance, integration breadth, production reliability | §13, §20, §21, §22 | Mostly — but scoped by audits/certifications/breadth, not a single feature |
| **C — Company Scale** | Customers, revenue, team, capital, distribution, partnerships | §23, §24 | **No** — this is what a raise is for, not a sprint |

Sections §1, §10, §11, §12 sit partly in Track A (their code prerequisites) and partly gated by decisions already made — §10 (Diagnosis/Prediction) explicitly deferred by you to Roadmap-only for now, §12 (Multi-App Intelligence) explicitly gated on §1's missing Organization entity, per your own stated principle below.

---

## 26. Full dependency chain (Track A, detailed)

This is the same Phase 1–6 order from §16, restated at the granularity of your message — 14 nodes, each one unlocking the next. Two hard sequencing rules are called out because they're principles you set, not just orderings:

```
1.  Real Specialist LLM Execution        (§2 — off runSpecialistStub, via geniusRoute + LlmProvider)
2.  Unified Verification Primitive       (§6 — verify(proposal) → Verified/Failed/Inconclusive)
3.  Real Audit + Memory on completion    (already real primitives, §1 — wired to 1+2's output)
4.  Tool Runtime                         (§3, Phase 2A — allow-listed tools)
5.  Tool Policy / Risk / Approval        (§3 — enforceEntityWrite extended to tool calls)
6.  Safe Execution                       (§3, Phase 2B/2C — isolation, sandbox)
7.  Confidence Calibration               (§7 — needs 1–3's real outcome data)
8.  Agent Reputation                     (§7 — needs §18's evaluation ledger)
9.  External Intelligence                (§4 — extends Verified Knowledge Engine)
10. Rights / Source Governance           (§4 — extends legal-media allow-list pattern)
11. Organization / Membership Model      (§1 — new entity, see hard rule below)
12. Diagnosis                            (§10 — needs 1–9's real historical data)
13. Prediction                           (§10 — needs 12 + §6's verification ground-truth)
14. Controlled Autonomous Engineering    (§10/§3 — needs 6 + 12/13)
```

**Hard rule 1 — Organization before Multi-App Intelligence (§12).** As long as `Project` is the top-level ownership unit (§1), do not build cross-project relationship features (e.g. "Atlas sees relationships between HotelOS and BrokerOS") as if they're one world. Node 11 (Organization/Membership/Consent) must exist first — otherwise this reopens exactly the cross-tenant leakage class of bug (evalSuites, proof/status, GitHub installations) that was found and fixed earlier this session.

**Hard rule 2 — Unified Verification before Prediction (§6 before §10).** Without a single `verify(proposal) → Verified/Failed/Inconclusive` primitive feeding consistent ground-truth into the evaluation ledger (§18), Confidence/Prediction has nothing real to calibrate against — building Diagnosis/Prediction without it produces plausible-sounding output with no verified accuracy behind it, not real intelligence. This is the same reasoning already documented in §6 and honored by your own "leave Diagnosis/Prediction as Roadmap for now" decision.

---

## 27. Where this leaves Atlas relative to the big players

Worth stating plainly, because "26 numbered gaps" can read as further away than it is. Splitting by track:

- **On architecture/idea**: already in a genuinely interesting place — Contradiction Engine, Blast Radius, Health Score, Digest, a real multi-provider LLM abstraction with real routing, and a genuinely vendor-neutral agent identity model are real code today (§17), not positioning.
- **On agent execution (Track A)**: the gap is concentrated, not diffuse — almost entirely §2 (Agent Reality) + §3 (Tool Runtime). Everything past that (Confidence, Reputation, External Intelligence, Diagnosis, Prediction) is a natural extension of infrastructure that already exists.
- **On enterprise platform (Track B)**: the gap is mostly hardening, integration breadth, and certification — not rethinking the architecture.
- **On company (Track C)**: the gap is real and large — customers, capital, team, distribution, scale — and that's normal for a startup at this stage, not a signal anything is wrong with the product.

The one-line framing this supports, if useful for a raise: *"We've already built the core intelligence and control plane. The next capital turns it into a production-grade agent execution platform, expands enterprise integrations and security, and establishes the first customer base."* That's a materially stronger, more honest claim than positioning Atlas as already comparable in scale to OpenAI/Microsoft/Google — and it's the one this document's evidence actually supports.

The **golden milestone** to point to concretely, once Phase 1 + Phase 2A land: *one real specialist, calling one real tool, doing one real task, with one real verification, producing one real audit trail.* Then three specialists, several tools, real evaluation. At that point Atlas stops needing to explain why it's an agent platform — it can just be shown working.
