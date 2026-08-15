# Gap vs world-class — Atlas positioning

**Status:** Living reference (Theme #7)  
**Date:** 2026-08-12  
**Purpose:** Compare Atlas to best-in-class peers and academic / standards sources — without turning Atlas into an IDE clone.

---

## What “world-class” means here

Not “more agents.” World-class **engineering truth / readiness** products answer:

1. What is verified vs assumed right now?  
2. What blocks a safe release?  
3. Can an AI propose a fix under human governance?

Atlas’s moat: **Evidence Graph + historical engineering memory + Constitution**, not the LLM.  
Category name: **The Truth & Control Layer for AI-Native Software** — not “like X but with AI.”

---

## Peer map (honest)

| Class | Examples | Atlas relation |
| --- | --- | --- |
| AI coding IDEs | Cursor, Claude Code, Copilot, Windsurf | **Workers.** Atlas sits underneath as truth/QA/governance. Do not compete on editor UX. |
| Code review bots | CodeRabbit, Copilot PR review | Overlap on findings; Atlas adds portfolio memory, epistemic labels, release Verdict. |
| SCA / SAST | Semgrep, Snyk, CodeQL | Feed candidates into Evidence (SECURITY). Atlas does not replace scanners. |
| Observability | Datadog, Grafana, Sentry | Deploy/runtime evidence feeds (future). Atlas owns readiness narrative + gates. |
| Spec / ADR tools | ADR tools, architecture decision records | Decisions center MVP — deepen linkage to Evidence. |
| QA platforms | Cypress Cloud, Playwright Trace, TestRail | QA LEARN + portfolio patterns; Atlas orchestrates risk-based QA, not test runners alone. |
| Governance / SOC2 | Vanta, Drata | Different ICP; Atlas is engineering readiness, not compliance checkbox SaaS. |

---

## University / standards sources (design inputs)

| Domain | Source (non-exhaustive) | How Atlas uses it |
| --- | --- | --- |
| Accessibility | WCAG 2.2 AA | Constitution domain 5 + a11y MVP pass |
| Security | OWASP ASVS / Top 10 | Constitution domain 2 + secret redaction |
| Reliability | Google SRE practices | Domains 15–17 (deploy/observability/reliability) |
| HCI / UX | Nielsen heuristics, WCAG | Expert lanes UI/UX + Constitution 7–8 |
| SEO (marketing sites) | Search-quality / Core Web Vitals | Applicability matrix — only when product type = marketing |
| Design systems | Material / platform HIG | Expert design lanes — advisory, evidence-backed |

Atlas does **not** scrape proprietary university content. Normative product rules stay in ADRs + Constitution.

---

## Gaps still between Atlas MVP and “world-class product”

1. **Live customer proof** — Design Partner runs (human) with real unknown risks found.  
2. **Deeper scanner ingestion** — wire Semgrep/CodeQL/Snyk outputs as Evidence packages.  
3. **Runtime truth** — production metrics/traces as DEPLOYMENT/OBSERVABILITY feeds.  
4. **Eval blocking gate** — expand Proof 1.1 into always-on CI gate for customer repos.  
5. **Multi-tenant HA SaaS** — durable dual-write exists; not multi-region HA yet.

---

## Non-goals (keep reminding)

- Replacing Cursor / Claude Code as the daily editor  
- 100 chatting agents  
- Vanity health % without Evidence  
- Unofficial partner scrapes  

---

## Verdict for Theme #7

**DONE as strategy doc.** Execution path: Design Partners + deepen feeds from scanners/runtime — not more IDE features.
