# Taqonu / ArletOS / Atlas — What the code actually says

Status: first-draft map, built directly from repo evidence — **for the owner to correct**, not a final decision.
Evidence date in the code itself: 2026-08-28 to 2026-08-30 (3 days before this document).

## The direct answer to "is `Atlas Core · ArletOS` a coordinated title or an accidental merge?"

**Neither, exactly — and it doesn't match the Taqonu → ArletOS → Atlas layering described earlier in this conversation.** Two pieces of hard evidence, both authored by this codebase itself, not by me:

1. **Root `package.json`**:
   ```json
   "name": "atlas",
   "description": "Atlas Core — engineering memory platform (ArletOS personal instance)"
   ```
   In the tooling's own words: **Atlas Core is the platform. ArletOS is the name of *this specific personal instance* of that platform** — like naming a laptop, not a separate architectural layer.

2. **`packages/shared/src/portfolio/seed.ts`** (the system's own internal self-model, seeded 2026-08-28) registers this exact repo as a single application:
   ```ts
   application(APP.atlas, "atlas", "Atlas / ArletOS", "TARGET", "github/taqonu-main", "main", COMMITS.atlas,
     "Destination. Fabric catalog is the only Atlas execution registry.")
   ```
   One application, one display name — `"Atlas / ArletOS"` — not two layers.

3. Every package in the repo, with no exception, is scoped `@atlas/*` (checked `agent-core`, `shared`, `state`, `knowledge`, `web`, `api`, `control-plane`). There is no `@arletos/*` scope, no `ArletOS`-only package, no code-level separation between "the memory/knowledge layer" and "the orchestrator." **Memory, Knowledge, Decisions, Architecture, and Agent infrastructure — the five things attributed to ArletOS in the earlier message — are already just Atlas's own subsystems in the code, not a separate layer underneath it.**

So: `Taqonu-main` is not "Taqonu ⊃ (ArletOS + Atlas)" as two sibling layers under one app. In the code as it exists today, it's **one platform (`Atlas`), personally named `ArletOS`** — full stop.

## Where "Taqonu" actually sits

This is the more interesting finding. "Taqonu" is not this repo's internal name for anything — it's the **broader namespace/portfolio** this repo belongs to. The portfolio governance data lists this repo (role: `TARGET`) alongside **six separate sibling repositories** (role: `SOURCE`) that Atlas is designed to observe and govern as "Managed Systems" (the same concept the README describes):

| Application | Role | Repo | What it is |
|---|---|---|---|
| **Atlas / ArletOS** | TARGET (this repo) | `github/taqonu-main` | The governance/memory/agent platform itself |
| Vantera | SOURCE | `github/vantera` | Property-ops product — has its own agents (V-One, Ventos) |
| HotelOS | SOURCE | `github/hotelOS-AI-main` | Hotel operations product |
| CaseFlow | SOURCE | `github/CaseFlow-AI-main` | Legal case-management product |
| BrokerOS | SOURCE | `github/brokerOS` (org: `github.com/taqonu/brokeros`) | Brokerage product |
| LexStudy | SOURCE | `github/LexStudy-main` (org: `github.com/taqonu/lexstudy`) | Legal-education product |
| Civio / Michtavia | SOURCE | `github.com/relaya17/civio` | Civic-rights product |

Two of these (BrokerOS, LexStudy) are explicitly recorded as living under a **`github.com/taqonu/...` organization** — a different namespace from `github.com/relaya17/...` (which owns this repo and Civio). That's likely why `github.com/relaya17/taqonu` 404'd earlier: **"taqonu" the GitHub org and this repo's own name/URL may not be the same thing** — worth checking directly which org actually hosts `taqonu-main` / `atlas`.

**So a more accurate hierarchy, per the code's own self-model, is:**

```
Taqonu (portfolio / brand — a GitHub namespace, not a code layer)
│
├── Atlas / ArletOS  ← THIS repo (taqonu-main). One platform, personally named ArletOS.
│     ├── Memory        packages/shared (13-state epistemic memory: FACT/VERIFIED/OBSERVED/…)
│     ├── Knowledge      packages/knowledge (separate RAG/verified-knowledge corpus — not the same store as Memory)
│     ├── System/Project state   packages/state (ProjectStateSnapshot — truth about a connected repo)
│     ├── Agent infrastructure   packages/agent-core (router → dispatch → LLM providers)
│     ├── Governance/verification  policies + judge + audit-log (packages/agent-core, apps/api)
│     └── Product surfaces   apps/web, apps/api, apps/admin, apps/control-plane ("Sentinel"), apps/worker
│
└── Managed Systems (SOURCE) — separate real products Atlas is meant to observe/govern, NOT part of this codebase
      ├── Vantera
      ├── HotelOS
      ├── CaseFlow
      ├── BrokerOS
      ├── LexStudy
      └── Civio / Michtavia
```

## The "Atlas" name-collision problem is already known — and already unresolved

The portfolio data doesn't just describe this structure — it explicitly flags a naming conflict the owner has not yet resolved:

> `"summary": "The word Atlas refers to taqonu-main, Vantera knowledge, CaseFlow /atlas UI, HotelOS planned oversight, and MongoDB Atlas."`

And a still-open governance decision (`decidedBy: null, decidedAt: null`, status `PROPOSED`, action `ESCALATE`):

> `"rationale": "CONFLICTING: Vantera uses 'Atlas' as product name. This is NOT taqonu Atlas. Requires explicit Owner resolution before any action."`

Concretely: **Vantera has its own, unrelated feature also called "Atlas"** (a lexical knowledge-retrieval service, `VAN-AG-003`, at `apps/api/src/services/knowledgeService.ts` in the Vantera repo) — explicitly marked `DO NOT IMPORT as an Atlas runtime agent`. CaseFlow has a `/atlas` UI route. MongoDB Atlas is a third, totally unrelated "Atlas." This is exactly the multi-system Atlas-naming confusion that prompted the question in the first place — and it turns out the codebase already caught it and parked it as an unresolved, owner-only decision.

## What's already been done, per the same data (dated 2026-08-28 → 2026-08-30, 1-3 days before today)

Under strict rules (`IMPORT_KNOWLEDGE_ONLY`, `fabricCatalogMutated: false`, `atlasAgentsCreated: 0`, `sourceExecutionPerformed: false`, `permissionsInherited: false`), four cross-portfolio knowledge patterns were owner-approved and ingested into Atlas's knowledge store — as *knowledge only*, with no code, execution, or permissions carried over:
- **Do-Not-Invent-Amounts** (from BrokerOS's accounting agent)
- **Confirm-Before-Send — Preview** (from BrokerOS's communication agent)
- **Confirm-Before-Send — Drafts** (from BrokerOS's correspondence agent)
- **No-Self-Validate** (from LexStudy's exam-validator agent)
- Separately, on 2026-08-30: **180 documents** of verified civic-rights knowledge from Civio, scoped to only the RESEARCHER and LEGAL_MEDIA_COMMS agents.

This means the "don't duplicate, don't import execution, only import knowledge with owner approval" discipline the earlier vision documents asked for is **already the operating model here** — not a new thing to build. It's real, dated, and has a clean audit trail (`auditEvents` in the same file).

## What this changes about the earlier work in this conversation

- The AI-governance-integration gap analysis I wrote earlier (`atlas-ai-governance-integration-gap-analysis.md`) still holds technically — it was scoped to *this* repo (Atlas/ArletOS), which is correct, since that's where the agent/governance code actually lives. Nothing there needs to change.
- What it was missing: it treated "Atlas" as if it were the only system in play. In fact Atlas's job description (per its own data) already includes being the **governance layer over six sibling products**, several of which have their own agents and their own (colliding) use of the word "Atlas." Any future "second opinion" or cross-agent supervision work should account for this — e.g., a policy that Atlas never treats another product's agent output as automatically trustworthy just because it's labeled the same way.
- The open `ESCALATE` decision on the Vantera naming collision is a real, existing, unresolved item — worth deciding (rename Vantera's feature, or formally document the two are unrelated) independent of anything else.

## Open questions for you to correct this draft

1. Is `github.com/taqonu/...` (the org that owns BrokerOS, LexStudy) actually your org, or a different namespace than `github.com/relaya17/...`? That would explain the earlier 404.
2. Does "ArletOS" mean something more to you than "personal instance name of Atlas Core" — i.e., do you *want* it to become a real separate memory/knowledge layer distinct from Atlas's orchestration, even though it isn't one in the code today? That's a legitimate direction, but it would be new work, not a rename of something that already exists split that way.
3. Should this document's "Managed Systems" list (Vantera, HotelOS, CaseFlow, BrokerOS, LexStudy, Civio) be treated as complete, or are there more products in the portfolio not yet registered in `seed.ts`?
