# ATLAS
## The AI-Native Engineering, Intelligence & Control Platform
### Corrected Positioning — Implemented vs. Partial vs. Roadmap
Version: 2026 (source-of-truth revision, grounded directly in the codebase)

---

## 0. Why this revision exists

An earlier version of this document mixed vision and implementation in several places — describing planned capabilities (prediction, diagnosis, a three-state risk decision) in the same voice as capabilities that actually run in the codebase today. That is a credibility risk in front of a CTO, an investor, or a technical due-diligence review: the first capability claim that turns out not to exist calls every other claim into question.

This revision applies one rule throughout:

> **Never present a roadmap capability as an implemented capability.**

Every claim below is tagged:

- ✅ **Implemented** — runs in the codebase today, verified against source.
- 🟡 **Partial** — the mechanism exists, but coverage, verification, or runtime proof is incomplete.
- 🔮 **Roadmap** — vision / future capability, not yet built.

---

## 1. Executive Definition (unchanged — this part was accurate)

Atlas is an independent, application-agnostic AI engineering and control platform designed to help developers, technical founders, CTOs, security teams, and technical professionals understand, build, operate, verify, and govern complex software systems.

Atlas is not a hotel system, not a CRM, not a legal system, and not a replacement for the business application it sits above. It is an independent intelligence and control layer, built on a generic business-entity model (`CUSTOMER | RECORD | DOCUMENT | FINANCIAL_TRANSACTION | CASE | COMMUNICATION | CONFIGURATION`) with no hotel-specific or vertical-specific concept anywhere in its core.

---

## 2. Capability Matrix (corrected)

| Domain | Status | What's actually true |
|---|---|---|
| Policy Engine (categorical entity authorization) | ✅ Implemented | `authorizeEntityAction` gates every business-entity CRUD action by `BusinessEntityType` × `EntityAction`. |
| Risk Engine (numeric scoring) | ✅ Implemented | Continuous 0–100 score → 4-bucket decision: `AUTO / AUTO_LOG / APPROVAL / HUMAN_ONLY`. **Not** `ALLOW / DENY / REQUIRE APPROVAL / SIMULATE` — `SIMULATE` does not exist anywhere in the system. |
| Unified Audit Log | ✅ Implemented | WHO / WHAT / WHEN / WHY / POLICY / RISK / APPROVAL / RESULT / TENANT, hash-chained NDJSON. Field names are `actorId / type / at / reason / policy / risk / approval / result / ownerId / projectId` — **not** `RESOURCE` or `EVIDENCE` as literal field names (evidence references live inside `input`, not as a dedicated field). |
| Epistemic / Knowledge Model | ✅ Implemented | 13 real states, not 7. No `DEPRECATED` state exists — closest is `STALE`. |
| Engineering Memory | ✅ Implemented | 12 memory types, exact match to spec. |
| Multi-tenant isolation (app-level) | ✅ Implemented | Ownership checks (`assertProjectWriteAccess`/`assertProjectReadAccess`) as the primary control, enforced across ~35 route files. |
| Multi-tenant isolation (DB-level RLS) | 🟡 Partial | RLS policies exist (`AUTH_RLS.md`, Supabase migration `20260812003000_rls_projects_evidence_tenant.sql`) as a backstop — **not yet verified live against a production database**. Treat as designed, not proven. |
| Agent Registry / Fabric | ✅ Implemented | Registered/fabric agents (`listRegisteredAgents`, `listFabricAgents`, agent lifecycle enable/disable) exist and are gated by the same Policy+Risk+Audit path as everything else. |
| Automation Engine | ✅ Implemented | Rule-based automation (`automation-engine.ts`, `automation-rules.ts`) exists and runs. |
| Detection / Anomaly | ✅ Implemented | Real z-score/IQR anomaly detection (`anomaly-detection.ts`) plus a platform watchdog. |
| Diagnosis (root-cause reasoning) | 🔮 Roadmap | No root-cause-hypothesis chain exists in the code today. Do not claim this as implemented. |
| Prediction (failure forecasting) | 🔮 Roadmap | No predictive-failure reasoning exists in the code today. Do not claim this as implemented. |

---

## 3. The Risk Engine, described correctly

Atlas's Risk Engine does **not** answer a binary "allow or deny" question. It answers a more useful question for a control plane:

> **How much autonomy is this specific action allowed to run with?**

The four buckets, in order of increasing scrutiny:

- **AUTO** — execute automatically, no human-visible trace required.
- **AUTO_LOG** — execute automatically, but record it for later review.
- **APPROVAL** — hold for human sign-off (or a valid approval-token automation) before executing.
- **HUMAN_ONLY** — always requires a live human decision; never auto-executable, even by approval-token automation.

This reframes the Risk Engine as an **Autonomy Control Layer**, not a gatekeeper. That is a stronger, more accurate story than "allow/deny/simulate" — it describes exactly what a buyer evaluating AI-agent governance actually needs: graduated trust, not a switch.

---

## 4. The Epistemic Model, described correctly

Atlas tracks 13 real epistemic states for engineering knowledge — not a simplified 7-state ladder, and no `DEPRECATED` state:

`FACT, CONFIRMED, VERIFIED, OBSERVED, INFERRED, ASSUMED, PROPOSED, UNVERIFIED, CONTRADICTED, STALE, UNKNOWN, CONFLICTED, INSUFFICIENT_EVIDENCE`

**Investor / high-level framing** (accurate, no oversimplification needed):

> Atlas maintains an epistemic state for every piece of engineering knowledge it holds, distinguishing certainty, verification, freshness, and conflict — so "Atlas remembers X" is never confused with "Atlas has proven X."

**Technical framing** (for due diligence / CTO docs): use the full 13-state list above, not a simplified subset.

---

## 5. The Audit Log, described correctly

Every significant action produces a unified, hash-chained audit entry with these actual fields:

`actorId (WHO) · actorKind · type (WHAT) · at (WHEN) · reason (WHY) · input · output · policy (POLICY) · risk (RISK) · approval (APPROVAL) · result (RESULT) · ownerId + projectId (TENANT) · correlationId · causationId`

There is no dedicated `RESOURCE` or `EVIDENCE` field — resource identity lives in `type`/`input`, and evidence references are carried inside `input` rather than as a first-class field. If a future revision wants explicit `RESOURCE`/`EVIDENCE` fields, that's a real schema change to scope, not something to describe as already present.

---

## 6. Corrected positioning language

**Do not say:**
> "Atlas predicts failures and diagnoses root causes."

This claims an unproven capability.

**Say instead:**
> Atlas observes and detects system behavior, evaluates actions through policy and risk controls, maintains engineering memory and evidence, and provides auditable control over software and AI-agent activity.

**Roadmap framing (clearly labeled as such):**
> Future capabilities include predictive risk, failure forecasting, and automated diagnosis.

---

## 7. Structural summary

```
                     ATLAS
                        │
        ┌───────────────┼────────────────┐
        ↓               ↓                ↓
   IMPLEMENTED       PARTIAL          ROADMAP
        │               │                │
  Policy Engine    RLS runtime        Prediction
  Risk Engine       verification      Diagnosis
  (Autonomy         (backstop exists,
   Control Layer)    not proven live)
  Unified Audit
  Epistemic Model
  (13 states)
  Memory (12 types)
  Agent Registry
  Automation Engine
  Detection/Anomaly
  Multi-tenant
  (app-level)
```

**Standing rule for every future deck, doc, or due-diligence answer:**
Every capability claim gets one of three tags — Implemented, Partial, or Roadmap — before it ships. No exceptions.
