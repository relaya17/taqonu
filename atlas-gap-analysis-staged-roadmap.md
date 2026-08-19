# ATLAS — Full Gap Analysis & Staged Roadmap
Version: 2026-08-19 (source-of-truth revision, every claim verified against the actual codebase this session)

---

## 0. How to read this document

This is the master gap list requested: "צור רשימה מכל כל החסרים שיש באפלקציה, נבנה את זה בשלבים והמסמך יתעדכן." It synthesizes the full "Atlas AI-Native Professional OS" vision (SDK, Agent Fabric, Tool Runtime, Sandbox, Knowledge Fusion, External Intelligence, Engineering Graph, Change Intelligence, Verification Engine, Confidence/Reputation, Explainability, Diagnosis/Prediction, Self-Healing, Professional Work OS, Universal Inbox, Multi-App Intelligence, Security-by-Architecture, SDK "Bring Your Own AI") against what actually exists in the codebase today. Every line below was checked against real files this session — not inferred from the vision documents.

Four tags, used consistently:

- ✅ **Implemented** — real, working code, verified.
- 🟡 **Partial** — the mechanism exists but is narrower / scattered / not fully wired.
- ❌ **Missing** — an engineering-hygiene gap (reliability/ops pattern), not a "vision" capability — should exist regardless of the bigger roadmap.
- 🔮 **Roadmap** — a vision capability with no existing implementation to build from.

This document will be updated stage by stage as work lands (per your instruction — "נבנה את זה בשלבים והמסמך יתעדכן").

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

## 3. Tool Runtime / Sandbox

❌ **Missing entirely.** No sandboxed code-execution or general tool-calling primitive exists anywhere. "Agent execution" today means calling a specific internal service function directly (e.g. the security scanner). No `read_file`/`write_patch`/`run_tests`-style capability-scoped tool contract exists yet. This is the single largest capability gap vs. OpenAI's Agents SDK, and it correctly should stay ❌/🔮 until built — not claimed as existing in any positioning document.

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

---

## 17. What's already stronger than the vision documents assumed

Worth saying plainly, because it changes the pitch: Contradiction Engine, Blast Radius, Engineering Health Score, Daily Brief/Digest, a 6-source cross-cutting priority queue, real multi-provider LLM abstraction with a real task router, and a genuinely vendor-neutral agent identity model are **all real, working code today** — not vision. The gap between "Atlas has governance infrastructure" and "Atlas visibly governs real autonomous work" is narrower and more specific than the original brainstorm suggested: it is almost entirely Phase 1 (§2) and Phase 2 (§3) above. Everything past that (Confidence, Reputation, External Intelligence, Diagnosis, Prediction) is a natural extension of infrastructure that already exists, not a separate bet.
