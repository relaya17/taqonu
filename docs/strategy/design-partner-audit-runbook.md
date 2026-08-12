# Design Partner — 1-Week Engineering Readiness Audit Runbook

**Status:** READY for human execution (playbooks complete — product hooks exist).  
**Companions:** [`design-partner-playbook.md`](./design-partner-playbook.md) · [`design-partner-execution-checklist.md`](./design-partner-execution-checklist.md) · [`case-study-template.md`](./case-study-template.md)

Compressed **7-day** motion for one production repo. Prefer this when the champion cannot spare two weeks; expand to the playbook’s Day 6–8 patch drill only if time allows.

Default locale in UI examples: `/he/…` (also `/en/…`, `/ar/…`). API base: `http://localhost:4000` (or your deployed host).

---

## Product map (what you actually open)

| Surface | UI | API |
| --- | --- | --- |
| Import (local / GitHub / remote) | `/he/partners` | `POST /api/v1/onboarding/import` |
| Storage policy (BYO story) | `/he/partners` | `GET /api/v1/onboarding/storage-policy` |
| Release Verdict | `/he` (home) | `GET /api/v1/projects/:id/verdict` |
| Evidence report | home / report flow | `GET /api/v1/projects/:id/report` |
| Readiness Certificate | `/he/readiness` | `POST /api/v1/readiness/certificate` · `GET /api/v1/readiness/certificates` |
| System Health + Constitution | `/he/health` | `POST /api/v1/audit-engine/run` · `GET /api/v1/audit-engine/reports` |
| Architecture Contract (optional) | `/he/contract` | `PUT /api/v1/audit-engine/contract` |
| GitHub App / PAT | `/he/integrations` | `GET /api/v1/github` · install routes |
| Portfolio health (multi-repo) | `/he/projects` | `POST /api/v1/portfolio/health` |
| Lab reference only | `/he/partners` | `GET /api/v1/case-studies/brokeros-001` |
| Usage counters | `/he/partners` footer | `GET /api/v1/analytics/usage` |

Import body shapes (see UI tabs):

```http
POST /api/v1/onboarding/import
Content-Type: application/json

{ "source": "local", "name": "…", "slug": "…", "workspaceRoot": "C:\\path\\to\\repo", "syncEvidenceToCloud": false }
{ "source": "github", "repo": "owner/repo", "syncEvidenceToCloud": false }
{ "source": "remote", "repoUrl": "https://…", "name": "…", "slug": "…", "syncEvidenceToCloud": false }
```

Health audit:

```http
POST /api/v1/audit-engine/run
Content-Type: application/json

{ "projectId": "<uuid>", "workspaceRoot": "<optional absolute path>", "intent": "optional one-liner", "includeConstitution": true }
```

---

## Day-by-day

### Day 0 — Qualify + prep (human)

- [ ] Confirm ICP: 5–40 eng, weekly deploys, GitHub or local monorepo, Staff/TL champion.
- [ ] Send outreach ([playbook](./design-partner-playbook.md) — EN + HE).
- [ ] Agree storage: BYO default; cloud evidence sync only if they opt in.
- [ ] Instance reachable; real `COOKIE_SECRET` if networked; GitHub App env **or** plan PAT/local import.
- [ ] Capture Day-0 answers (production-ready definition, biggest unknown, last incident, senior hrs/week, agents in use).

### Day 1 — Connect + baseline Verdict / Certificate

1. Import at **`/he/partners`** (`POST /api/v1/onboarding/import`). Leave `syncEvidenceToCloud` off unless agreed.
2. Note inline Verdict: `status`, `productionReadiness`, blockers, high risks, unverified claims.
3. Open **`/he`** and/or `GET /api/v1/projects/:id/verdict?locale=he`.
4. Open **`/he/readiness`** — walk Certificate dimensions (each must open to Evidence).
5. Optionally `GET /api/v1/projects/:id/report?locale=he` for the Evidence report snapshot.
6. Screenshot / paste numbers into the [partner fill-in](../case-studies/_partner-fill-in.md) “baseline” row.

### Day 2 — System Health + Constitution

1. **`/he/health`** → Run audit (`POST /api/v1/audit-engine/run` with `projectId` + intent).
2. Record overall score, critical/high counts, **omissions** (Omission Detector).
3. Every `UNKNOWN` / `INSUFFICIENT_EVIDENCE` stays labeled — do not round up.
4. If applicability is wrong for their product type → **`/he/contract`** then re-run audit.

### Days 3–4 — Deepen findings (no vanity tour)

- [ ] Re-run Health after any agreed code/config change.
- [ ] For each candidate case-study finding: severity · previously known? · Evidence path/id.
- [ ] Ask champion live: “Did you already track this?”
- [ ] Optional: `/he/projects` portfolio health if a second related repo is connected.
- [ ] Do **not** lead with agent chat — Evidence surfaces only.

### Day 5 — Optional governed remediation (skip if thin calendar)

- [ ] Only LOW/MEDIUM with a safe draft path. Approve → apply → verify in front of the champion.
- [ ] CRITICAL → recommend only (human). No silent WRITE.

### Day 6 — Readout rehearsal (internal)

- [ ] Script: Certificate → 1–3 headline findings with Evidence → UNKNOWN → owned.
- [ ] Pull live metrics again (Verdict + Health) so Day 7 uses current numbers.
- [ ] Draft ROI sketch from Day-0 senior-hours answer (partner-approved numbers only).

### Day 7 — Champion readout + capture

- [ ] Live: `/he/readiness` + `/he/health` (+ Verdict on `/he`).
- [ ] Ask: time/risk impact? continue / pause / expand?
- [ ] Written permission for anonymized (or named) case study — or mark “no publish.”
- [ ] Fill [`case-study-template.md`](./case-study-template.md) via [`_partner-fill-in.md`](../case-studies/_partner-fill-in.md).
- [ ] Copy approved write-up to `docs/case-studies/00X-{slug}.md` (BrokerOS `001` is **lab only**).
- [ ] Log outcome on [`design-partner-tracker.md`](./design-partner-tracker.md) + tracker changelog if material.

---

## Success metrics (check at Day 7)

**Partner proof (need ≥1):**

- [ ] ≥1 previously unknown HIGH/CRITICAL with Evidence  
- [ ] ≥1 production blocker made explicit (BLOCKED/UNKNOWN → owned)  
- [ ] Stale architecture / docs claim detected  
- [ ] Regression / release risk before a planned deploy  

**Us (need all that apply):**

- [ ] Certificate + Verdict generated with Evidence drill-down  
- [ ] Health/Constitution run completed (or documented skip reason)  
- [ ] Champion quote or explicit decline-to-quote  
- [ ] Publish permission recorded (yes/no/anonymize)  
- [ ] Decision: continue / pause / expand  

Counters: `GET /api/v1/analytics/usage` (`designPartnerSessions`, verdicts, certificates) — do not invent customer names in docs.

---

## Guardrails

Same as the execution checklist: Evidence over chat · no silent WRITE · no vanity % without drill-down · BrokerOS case is lab reference only.
