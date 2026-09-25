# Web / Studio master plan

Date: 2026-09-26

Status: **DIRECTION LOCKED. Stage 0 is closed as an inventory. Stage 1 has not started.**

This document is the source of truth for reorganizing Atlas Web around the rooms that already exist. It does not authorize a new Studio, a second editor, a second memory store, a second agent, or a parallel Apply path.

## Binding rules

1. Do not add a capability that already exists.
2. Do not rebuild Studio, memory architecture, or Control.
3. Close connections first. Implement the four real gaps only after those connections are closed. Verify after that.
4. Observation, analysis, memory, and specialist knowledge may reach a **proposal**. They do not receive a new authority.

```text
Observation
  → Analysis / Memory / Expert knowledge
  → Recommendation
  → Proposal
  → Human / second-identity approval
  → Apply
  → Verify
  → Evidence
```

5. Fix, Explain, Diagnose, Review, and recurring-failure detection stop at Proposal unless they enter the existing governed patch path. They do not write the workspace by themselves.
6. A project file is not user memory. User memory is not project memory. Atlas knowledge is not user memory. Specialist memory is not personal memory. A chat thread is not the Personal Supervising Agent record.

## Rooms

| Room | Job | Not this |
| --- | --- | --- |
| Dashboard | Command center. What needs attention, and where to go next | A second editor |
| Projects | Create a project and bind its workspace folder | The engineering room |
| Studio | The engineering room | A chatbot page or an IDE clone |
| Personal Supervising Agent | Persistent coordinating layer, `psa:<ownerId>` | A nav item, a tool-runner, or CODE_ENGINEER |
| Fabric catalog | 16 specialist identities | The personal agent |
| Agents & Knowledge | Specialist catalog and approved sources | A merged super-agent |
| Account | Identity, settings, plan | User-storage metering (that meter does not exist yet) |
| Control | Authority: policy, SoD, Apply, Verify, Rollback, evidence, kill switches | A new approval engine |

## Work classes

| Class | Examples | Action |
| --- | --- | --- |
| PRESERVE | Files, Terminal, Run, Git, Checks, PSA record, patch workflow, Fabric catalog, owner-scoped memory | Do not rebuild |
| MOVE | Health, Truth, Readiness, QA, Process Audit, Observer, Sentinel | Show them as Studio Checks. Keep routes as aliases |
| CONNECT | Dashboard → Studio, Projects → Studio, PSA panel → existing PSA APIs, desk patches → the same remediation case | This is the bottleneck |
| IMPLEMENT | File rename/move on disk, recurring-failure engine, memory lifecycle and user storage meter, second-identity UI | Not authorized by Stage 0. A later stage must be explicitly authorized |

## Stage order

Do not skip ahead. Do not start Stage 2 by redesigning the editor.

### Stage 1 — Project context

Dashboard and Projects open Studio with the selected project id.

Studio already reads `?project=`. The current buttons do not pass it:

- Dashboard Studio button is `href="/studio"`.
- Projects “Open Studio” is `href="/studio"`.
- Projects “Open workbench” is `href="/workbench"` with no id.

No new project mechanism.

### Stage 2 — Studio as the work center

Arrange controls that already exist around the open file:

```text
Files → Editor → Problems → Git → PSA → Actions → Run / Checks
```

Actions in this stage mean Explain, Diagnose, and Review as entry points. They do not create an independent execution path. They stop at recommendation or proposal.

### Stage 3 — Personal Supervising Agent

Wire the existing endpoints into `SupervisingAgentPanel`:

- explain
- recommend
- escalate
- request

Identity stays `psa:<ownerId>`. Request must keep a Fabric specialist id. Do not merge the PSA with CODE_ENGINEER or with the 16 specialists. The PSA coordinates. It does not impersonate them and it does not approve or apply.

### Stage 4 — Control inside Studio

Show the second identity and the SoD decision inside the existing patch workflow.

Do not create a new approval engine. The requester’s own `decide-and-execute` stays denied. The decider remains a distinct identity.

### Stage 5 — Dashboard and patch verification

The desk must show the same remediation world Studio already uses.

Today the desk verify call is `POST /api/v1/remediation/drafts/:id/verify`. Studio’s proven verify call is `POST /api/v1/code/patches/:id/verify`. Do not add a third verify. Connect the desk to the evidence and state of that same fix.

### Stage 6 — Checks

Stop treating these as parallel rooms:

- Truth
- Health
- Readiness
- QA
- Process Audit
- Observer
- Sentinel

They already exist as Studio Checks. Sidebar entries and old URLs stay as aliases or redirects so bookmarks do not break. Do not delete the panels.

### Stage 7 — Memory lifecycle

Only here do the absent memory-management capabilities begin:

- consolidate or archive records
- use the existing `supersededBy` field
- a real user storage meter
- warnings about **user storage**, not server process RAM (`memoryWarningMb` is not that meter)

Place this under Account or Dashboard according to the room jobs above. Do not auto-delete user-owned memory.

### Stage 8 — Recurring-failure intelligence

This is a real gap, not more UI on top of retrieval.

```text
verified events
  → recurrence detection
  → relevant memory
  → recommendation
  → evidence references
```

Memory retrieval already exists. It is not this engine. INFERRED stays INFERRED. Do not present a similarity as FACT or CONFIRMED.

### Stage 9 — File operations

Only if still required after the connections above: rename or move a file on disk.

That operation stays inside the existing governed write path. The PSA and Agent chat do not perform it silently.

### Stage 10 — Production verification

After the local connections are done, return to what is environment-blocked:

| Check | Block |
| --- | --- |
| Production authenticated Studio | No automated Production account. No customer workspace on the API host |
| CI Apply, SoD, Rollback | `SUPABASE_SERVICE_ROLE_KEY=replace-me` disables the live approval store |
| PSA Control telemetry | Empty unless Control Plane URL and token are set |

A missing product and a product that exists but cannot be verified in an environment are different. Do not rebuild the local path to get around the block. Do not invent credentials.

## Prior local evidence — not re-run in Stage 0

The items below are **PRIOR VERIFIED EVIDENCE**. Stage 0 did not re-run `pnpm test:e2e:stage9`, CI, or Production sign-in.

Stage 9 browser evidence, recorded earlier as `pnpm test:e2e:stage9`, 19 passed:

- login, session, logout
- project isolation, refresh, deep link when `?project=` is already present
- CODE_ENGINEER `POST /api/v1/studio/ask-agent` creates a patch proposal
- requester `decide-and-execute` is 403
- distinct decider apply, verify, and rollback restore `hello.ts` bytes

Ask Agent under `NODE_ENV=production` returns 201 when the audit log is not skipped. `ATLAS_SKIP_AUDIT_LOG=1` together with production still throws. That fail-closed rule stays. CI workflow commit `64d55d0` removes the skip flag from the e2e job. It was not pushed at the time this plan was written. It does not make CI Apply pass.

## Epistemic states already in the schema

`EPISTEMIC_STATES` in `packages/shared/src/constants/epistemic.ts` includes:

FACT, CONFIRMED, VERIFIED, OBSERVED, INFERRED, ASSUMED, PROPOSED, UNVERIFIED, UNKNOWN, CONFLICTED, CONTRADICTED, STALE, INSUFFICIENT_EVIDENCE.

`EPISTEMIC_V1_TO_V2` maps `CONFIRMED` to `VERIFIED`.

`VERIFIED` in that list is a memory/knowledge epistemic state. A Studio patch status of `VERIFIED` is a different concept. Do not treat them as one state machine. Do not rename the schema.

## Out of scope for the first implementation pass

- a new editor
- a new memory database
- a new personal agent
- a new Apply or verify endpoint
- weakening SoD, kill switches, or the production audit rule
- Stage 10 of the old Stage 9 program (this document’s Stage 10 is production verification of Web/Studio connections, not that other program)

## Stage 0 closure limits

No additional genuinely missing capabilities were identified within the audited scope. That sentence does not claim the whole Atlas product was exhaustively searched.

The test named “CODE_ENGINEER lane cannot see a DEBUGGER-scoped lesson” shows that the CODE_ENGINEER retrieval does not contain the phrase `debugger-only verified fix`. The same test also expects that phrase to be absent from the DEBUGGER retrieval. Positive retrieval by DEBUGGER is **PARTIAL / INCONCLUSIVE**. Running that test again would not prove the positive case.

CI Apply, SoD, and Rollback stay **ENVIRONMENT-BLOCKED** while `SUPABASE_SERVICE_ROLE_KEY: replace-me`. PSA Control telemetry stays environment-blocked when the Control URL or token is absent. Those blockers are not product defects.

Disk rename/move remains a capability gap. This closure does not authorize implementing it.
