# Design Partner — Execution Checklist

**Companion to:** `docs/strategy/design-partner-playbook.md` (pitch, qualification, outreach EN+HE),
`docs/strategy/design-partner-audit-runbook.md` (1-week day map · UI/API),
`docs/strategy/design-partner-tracker.md` (empty A–E slots),
and `docs/strategy/case-study-template.md` / `docs/case-studies/_partner-fill-in.md` (write-up after).

   This doc is the "what do I actually click/run in Atlas" layer — one concrete step per playbook day.
Prefer the **1-week runbook** when calendars are tight; use Days 6–8 / Day 9–10 below when deepening.

**Status:** Playbook-complete · product surfaces ready · **human must still send outreach and run the audit**.

**Precondition:** MVP closed (see `living-request-tracker.md`). Nothing here requires new core features.

---

## Before Day 0 — pick the partner + prep the instance

- [ ] Pick 1 candidate matching qualification bar (5–40 eng, weekly deploys, GitHub or local monorepo, one Staff/TL champion).
- [ ] Send the outreach email (template in the playbook) or use a warm intro.
- [ ] Decide **storage mode** up front and be ready to explain it in one line: BYO by default (code never leaves their host/disk — Atlas only stores evidence/observations), optional cloud evidence sync (`syncEvidenceToCloud`) if they want the certificate persisted off their machine.
- [ ] If they'll connect via GitHub App (not just a PAT): confirm `GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY` / `GITHUB_APP_SLUG` are set in your deployed API env — `GET /api/v1/github` on your instance should report `installation: "configured"` or better before the call. If unset, plan to use the GitHub PAT path or local/remote import instead — don't block the session on App setup.
- [ ] Confirm your instance is reachable by the partner (or you're screen-sharing) and `.env` has a real `COOKIE_SECRET` set (not the dev default) if you're going over the network.

## Day 0 — connect + first Certificate

1. Ask the 5 qualification questions from the playbook (production-ready definition, biggest unknown, last incident, senior hours/week on review, coding agents in use). Write the answers down — they become the "Context" section of the case study later.
2. Connect the repo at **`/partners`**:
   - Local clone on your machine → **Local** tab, paste the workspace root.
   - They grant a GitHub App install or hand you a PAT → **GitHub** tab, `owner/repo`.
   - Anything else (GitLab, Bitbucket, private host) → **Remote** tab (metadata-only link, no code upload).
   - Leave **"sync evidence to cloud"** off unless they explicitly opted into cloud storage in the Day 0 conversation.
3. On success you land on a Verdict summary inline (status, production readiness /100, blockers, high risks, unverified claims) with buttons to **Readiness** and **Verdict**. Screenshot or note the initial numbers — this is your "before."
4. Open **`/readiness`** — the full Production Readiness Certificate. Walk the champion through it live if they're on the call; otherwise save it for the Day 9 readout.
5. Open **`/health`** — the Engineering Constitution scorecard (23 domains + Omission Detector). This is where you'll find the "nobody thought of this" findings the playbook's success criteria ask for.
6. If GitHub is connected: confirm the integrations page (`/integrations`) shows the connection active, and — if using the GitHub App — that `/integrations` shows an installation row (App status, not just PAT).

## Days 1–5 — deepen evidence, chase UNKNOWNs

- [ ] Re-run the audit if the repo changes: `POST /api/v1/audit-engine/run` (or re-trigger from `/health`).
- [ ] Every `UNKNOWN` / `INSUFFICIENT_EVIDENCE` claim on `/health` or `/readiness` is a candidate finding — do **not** let the champion (or yourself) round it up to "probably fine." That's the product's whole differentiator.
- [ ] If the partner wants the applicability profile tuned to their product (e.g. no consumer-privacy domain for an internal tool), use the Architecture Contract editor at **`/contract`** (`PUT /api/v1/audit-engine/contract`) rather than silently suppressing a finding.
- [ ] Check **`/projects`** if they connect more than one repo — portfolio-wide health rollup lives there.
- [ ] Log every finding you plan to use in the case study with its Evidence path (file/line, claim id, or check id) — the case study template requires "previously known? yes/no" per finding, so ask the champion in real time.

## Days 6–8 (optional) — one governed change

- [ ] Only if a LOW/MEDIUM finding has a safe AUTO_FIX draft available. Walk the draft → approve → apply → verify loop live. **Never** apply without an explicit approve click from you or the champion — this is the product's non-negotiable (`WRITE` policy in the tracker's locked definitions).
- [ ] If anything is CRITICAL, do not auto-remediate — hand it to the champion as a recommendation, per the remediation policy (LOW auto · MEDIUM PR · HIGH recommend · CRITICAL human).

## Day 9 — readout

- [ ] Pull up `/readiness` (Certificate) and `/health` (Constitution scorecard) live.
- [ ] Walk through: score breakdown → 1–3 headline findings with Evidence → what was UNKNOWN before vs. now owned.
- [ ] Ask directly: does this save senior time on release review? How much?
- [ ] Get a decision: continue / pause / expand to a second repo.
- [ ] If they'll let you publish: get written permission to anonymize (or name, if they're comfortable) for a case study.

## Day 10 — capture

- [ ] Fill in `docs/case-studies/_partner-fill-in.md` (or `docs/strategy/case-study-template.md`) with real numbers (findings table, before/after ROI sketch, quote, certificate snapshot).
- [ ] Save under `docs/case-studies/00X-{slug}.md` (see `001-brokeros.md` for the lab-only reference format — this one won't have the "lab only" caveat once it's a real partner).
- [ ] Update a row in `docs/strategy/design-partner-tracker.md` (never invent company names).
- [ ] Usage/`designPartnerSessions` counters update via `/api/v1/analytics/usage` on product paths — no manual inventing of customers.
- [ ] Update `living-request-tracker.md` §D P1 / changelog with the outcome (ran / findings count / continue-or-not) so it's not lost.

## Success metrics checklist (copy into tracker notes)

**Partner (≥1):** unknown HIGH/CRITICAL · blocker made explicit · stale architecture · regression before deploy.  
**Us:** Certificate+Verdict with Evidence · Health run (or skip reason) · quote or decline · publish permission · continue/pause/expand.  
Full boxes: end of [`design-partner-audit-runbook.md`](./design-partner-audit-runbook.md).

## Guardrails (don't break the pitch)

- Don't demo the chat/agent surfaces as "AI sounds smart" — the pitch is Evidence, not conversation.
- Don't silently merge FACT from a thin prompt — if `/health` or `/readiness` shows `INSUFFICIENT_EVIDENCE`, say so out loud.
- Don't apply a WRITE without an explicit approval click in front of the champion.
- Don't quote a vanity health percentage without offering the Evidence drill-down.
