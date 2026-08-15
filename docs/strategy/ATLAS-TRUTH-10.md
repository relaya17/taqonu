# ATLAS TRUTH-10

**שם לזכור:** `TRUTH-10`  
**קובץ זה:** `docs/strategy/ATLAS-TRUTH-10.md`  
**סטטוס:** Living — מתעדכן בכל התקדמות  
**עדכון אחרון:** 2026-08-15 (**P2.8b bind Managed System — facets, contract, ACT auth, command path**)  
**מטרת ציון:** **10/10** — Software Intelligence Platform (לא עוד כלי AI)  
**סטטוס מוצר (MVP Proof):** P0 `DONE` · Sentinel `DONE` · P1 deepen `PARTIAL→stronger` · GTM packs READY (human ops)

> **חוק מוצר:** No evidence = no strong claim.  
> **Loop:** Change → Impact → Evidence → Risk → Verification  
> **מוח:** Software Knowledge Graph אחד — כל המנועים עליו.

---

## איך לעבוד עם המסמך

1. תמיד מתחילים מהפריט הראשון ב־`P0` עם סטטוס `OPEN` / `IN_PROGRESS`.  
2. כשמסיימים: מעבירים ל־`DONE` + שורה ב־**Change log**.  
3. לא מוסיפים 50 פיצ׳רים חדשים לפני ש־P0 ירוק.  
4. סטטוסים: `DONE` · `IN_PROGRESS` · `PARTIAL` · `OPEN` · `DEFERRED` · `BLOCKED`

---

## צפון אחד (North Star)

| | |
|---|---|
| **מה אנחנו** | Truth + Evidence + Governance + Intelligence + Automation Control מעל Managed Systems |
| **מה אנחנו לא** | IDE · chatbot · “AI שעושה הכול” · אוסף SAST · AI coding assistant |
| **Killer** | Behavioral drift + Impact על Graph + Evidence |
| **הוכחה ל־DP** | `analyzed N · risks M · confirmed K · caught before prod` |
| **תמחור** | Engineering surface / repos / seats — לא AI calls |
| **אבטחה** | אין למידה חוצת־tenant על קוד לקוחות |

---

## P0 — חובה ל־MVP Proof (לפי סדר ביצוע)

| # | משימה | למה | סטטוס | נתיבים / הערות |
|---:|---|---|---|---|
| 0.1 | מסמך TRUTH-10 (זה) | מקור אמת לעבודה | `DONE` | `docs/strategy/ATLAS-TRUTH-10.md` |
| 0.2 | Observer package + cycle | Temporal + behavior + bugs seed | `DONE` | `packages/observer` · `/observer` |
| 0.3 | **Software Knowledge Graph v0** | המוח — calls / depends / tested_by | `DONE` | `packages/observer/src/graph` · `/api/v1/graph/nodes` |
| 0.4 | Graph Impact (transitive) | שינוי אחד → מי נשבר | `DONE` | `computeGraphImpact` · `/api/v1/graph/nodes/:id/impact` |
| 0.5 | Observer ↔ Graph sync | כל cycle מעדכן את המודל | `DONE` | cycle שומר `.atlas/genome/graph.json` |
| 0.6 | Behavioral Verification v1 | EXPECTED vs OBSERVED flows | `DONE` | `.atlas/genome/expected.json` · GET/PUT `/observer/expected` · `/truth` compare |
| 0.7 | Evidence על כל finding | מקורות + confidence | `DONE` | `evidenceRefs` על findings + Evidence drafts |
| 0.8 | Risk scoring על Impact+Behavior | HIGH רק עם ראיות | `DONE` | `scoreRiskWithGraph` + blast radius |
| 0.9 | Continuous Observer (Git/PR/Deploy hooks) | Always-on, לא רק כפתור | `DONE` | GitHub webhook + deploy feeds → `tryContinuousObserve` |
| 0.10 | **ATLAS HEALTH dashboard (מסך אחד)** | 10/10 UX — לא 30 גרפים | `DONE` | `/truth` |
| 0.11 | Audit / evidence history UI | היסטוריית cycles + snapshots | `DONE` | `.atlas/cycles` + `.atlas/snapshots` · `/observer/snapshots` · `/truth` |
| 0.12 | Design Partner measurement counters | analyzed / risks / confirmed / caught | `DONE` | `.atlas/metrics/truth-counters.json` |

---

## P1 — אחרי Proof עם Design Partners

| # | משימה | סטטוס |
|---:|---|---|
| 1.1 | Autonomous Remediation (propose→test→verify→approve) | `PARTIAL` — Truth propose + gates + **re-observe verify** + Oracle approve/verify audit; HIGH blocked; לא prod auto |
| 1.2 | Security Graph (identity→API→data) | `DONE` — IDENTITY/DATA_STORE + **policy**: EXPOSES_DATA requires AUTHENTICATED_BY |
| 1.3 | Production Intelligence (logs/traces/metrics) | `PARTIAL` — probes + deploy → graph + **failed-deploy finding/INCIDENT**; לא APM חי |
| 1.4 | Engineering Memory ↔ Graph (ADR conflicts) | `PARTIAL` — conflict detect + **expanded DECIDED_BY topics** |
| 1.5 | Isolation / no cross-tenant learning (product claim + controls) | `DONE` — owner bind + denied audit + Truth isolation chips |
| 1.6 | CI/CD deep integrations | `PARTIAL` — webhook observe + Check Run (**annotations**) + CI secret scan |

---

## P2 — רק אחרי בסיס ירוק

| # | משימה | סטטוס |
|---:|---|---|
| 2.1 | Multi-agent specialists (Architect, Runtime, Security…) | `PARTIAL` — Fabric קיים; לא להרחיב |
| 2.2 | Benchmarking versions/teams | `PARTIAL` — `GET /api/v1/portfolio/truth-benchmark` + counters seed |
| 2.3 | Patent landscape / Trademark Atlas | `OPEN` — משפטי, לא קוד |
| 2.4 | Pricing experiments (repos/seats) | `PARTIAL` — freemium usage היום · WTP script |
| 2.5 | Case studies + Seed narrative | `PARTIAL` — template + [`seed-narrative.md`](./seed-narrative.md) |
| 2.6 | **Admin Oracle / Command Agent** (לוח בקרה יוקרתי) | `PARTIAL` — A1 + Sentinel feed + approve/verify audit + digest persist |
| 2.7 | **Atlas Sentinel** (Defensive Security Agent) | `DONE` — S1.1–S1.7 (specialist packs) |
| 2.8 | **Managed System abstraction** (command center, not rewrite) | `DONE` for bind — real facets from evidence/feeds · persisted contract + invariant verify · `/systems/:id` · ACT ownership + no prod auto-apply. Stripe/Generic REST **not** added. |

---

## A1 — Admin Oracle / Command Agent (חזון מוצר)

**שם לזכור:** `Admin Oracle` · `Command Agent`  
**מטרה:** סוכן אחד שעליו מושתת לוח הבקרה באדמין — מנהל את הדשבורד, מזהה בעיות, ומבצע ניטור + תיקון **רק עם ראיות ומקורות מורשים**.

> זה **לא** “AI שעושה הכול בלי בקרה”.  
> זה **מנבא תפעולי** על Graph + Evidence: מקבל עדכונים שוטפים → מדרג סיכון → מתריע / מציע / מתקן תחת שערים.

### מה הסוכן עושה

| תפקיד | פירוט |
|---|---|
| **מנהל לוח הבקרה** | UI אדמין יוקרתי אחד: בריאות מערכת, באגים, גרסאות, פריסות, סייבר, תור פעולות |
| **מזהה** | באגים · רגרסיות · גרסאות לא יציבות · קריסות · כשלי deploy · סטיות התנהגות |
| **מנטר** | Continuous observe + alerts; תור יומי של חריגות |
| **מתקן / מעדכן אותך** | Propose→Approve→Apply לתיקונים בטוחים; HIGH/CRITICAL = התראה + המלצה (לא auto-prod בלי אישור) |
| **סייבר הגנתי** | Threat intel ממקורות **מאומתים ומורשים בלבד** (CVE/NVD/CISA/vendor advisories / חוקים ורגולציה שפורסמו) — **לא** התקפה, סריקה לא מורשית, או כלי פריצה |
| **בריפינג הייטק יומי** | עדכון יומי מ־allowlist: חידושים, שינויי גרסאות קריטיות, advisories — עם לינק + epistemic label |

### מקורות מורשים (Allowlist — חובה)

- Atlas Truth / Observer / Graph / Deploy feeds / GitHub Check Runs (פנימי)  
- CVE / NVD / CISA / vendor security advisories  
- Release notes רשמיים (Node, Next, React, Postgres, וכו׳ לפי stack של הלקוח)  
- מסמכי חוק/רגולציה רשמיים שצוינו ב־allowlist (לא גלישה חופשית לאינטרנט)  
- **אסור:** מקורות אנונימיים, “טיפים לפריצה”, סקריפטים התקפיים, למידה חוצת־tenant על קוד לקוחות  

### שערים (Gates)

1. כל טענה חזקה דורשת `evidenceRefs`.  
2. תיקון אוטומטי רק LOW (כמו היום) + WRITE session; אחרת Propose.  
3. פעולות סייבר = **הגנה/התראה/הקשחה** בלבד.  
4. Admin surface לפי [`admin-necessity.md`](./admin-necessity.md) — לא לבנות `/admin` סתם.

### פירוק ביצוע (אחרי P1 יציב / עם DP)

| # | משימה | סטטוס |
|---:|---|---|
| A1.1 | מסך Admin Command Center (premium dashboard shell) | `PARTIAL` — `/admin` + `/admin/oracle` |
| A1.2 | Agent persona + תור פעולות (detect → rank → notify/propose) | `DONE` — queue + watchdog/remediation/cyber/**sentinel** |
| A1.3 | Version instability detector (deps/runtime/EOL) | `PARTIAL` — Node EOL + Next/React/TS/pg majors |
| A1.4 | Daily Hi-Tech / Advisory brief (allowlisted ingest) | `PARTIAL` — brief חי + **persist** `admin.oracle.brief.YYYY-MM-DD` |
| A1.5 | Defensive cyber feed → findings על Graph (CVE↔deps) | `DONE` — allowlisted advisories → Sentinel + PACKAGE/INCIDENT graph |
| A1.6 | Full automation loop עם audit trail (מי אישר / מה הוחל) | `PARTIAL` — refresh + **approve/verify audit** |
| A1.7 | “מנבא” digest: בוקר אחד — סיכום + Top 3 actions | `PARTIAL` — digest API + UI + snapshot meta |

**תלות:** P0 DONE · P1.1 remediation · P1.3 production · G5 security review לפני automation רחבה.

---

## S1 — Atlas Sentinel (Defensive Security Agent)

**שם לזכור:** `Sentinel` · `Atlas Sentinel`  
**עמדה:** **כן — לבנות.** כשכבת הגנה נפרדת מהמוח ההנדסי — לא כ־“סוכן תקיפה”.

```
                         ATLAS (Truth / Graph / Evidence / Risk)
                           │
                 ┌─────────┴─────────┐
                 │   SENTINEL        │  Defensive Security Agent
                 └─────────┬─────────┘
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
   Code Security       Runtime Security    Infrastructure
   Secrets · Auth      Logs/APIs/Abuse     Cloud · CI/CD
   Deps · Injection    Sessions            Config · Network
```

### שני מוחות משלימים

| מוח | שואל | כבר קיים / יעד |
|---|---|---|
| **Engineering Observer** | מה התוכנה עושה? | Observer · EXPECTED/OBSERVED · `/truth` |
| **Security Observer (Sentinel)** | האם זה בטוח? | Security Graph seed · Oracle cyber · **S1** |

שניהם מזינים את אותו: **Evidence + Temporal + Risk** — בלי מוח AI שמאשר את עצמו.

### מה Sentinel עושה (הגנתי בלבד)

| # | יכולת | הערה |
|---:|---|---|
| 1 | Secret Detection | API keys / tokens / credentials שנכנסו ל־repo |
| 2 | Dependency Security | deps מסוכנים + שרשראות (על בסיס advisories מורשים) |
| 3 | AuthN / AuthZ | RBAC · API perms · sessions · tenant isolation · privilege boundaries |
| 4 | API Security | auth required · authz · over-exposure · unsafe writes · validation |
| 5 | Configuration Security | `.env` · CORS · cookies · JWT · headers · DB/storage · deploy |
| 6 | **Security Regression** | Temporal: לפני/אחרי שינוי — האם נעלם authorization check? + Evidence |

### Security Verification Loop (חובה)

```
DISCOVER → ANALYZE → RISK SCORE → COLLECT EVIDENCE
    → PROPOSE FIX → APPLY IN SANDBOX → RUN SECURITY TESTS
    → VERIFY (מנוע בדיקה נפרד) → REPORT
```

> AI **לא** מאשר שהתיקון הצליח רק כי הוא כתב אותו.  
> Verify = ראיות ממנוע נפרד (tests / policy checks / graph diff).

### מה אנחנו לא בונים

- תקיפות על מערכות זרות · exploit PoCs · סריקות לא מורשות  
- “red team as a service” על לקוחות אחרים  
- למידה חוצת־tenant על קוד לקוחות  

### פירוק ביצוע

| # | משימה | סטטוס |
|---:|---|---|
| S1.0 | מסמך Sentinel + חוזה הגנתי (זה) | `DONE` |
| S1.1 | Secret Detection v0 על workspace מקושר | `DONE` — `detectSecrets` · POST `/sentinel/scan` (redacted) |
| S1.2 | Dependency advisories → Graph / Truth findings | `DONE` — allowlisted match · PACKAGE/INCIDENT · observe cycle · `/truth` |
| S1.3 | AuthZ regression (Temporal: route איבד guard) | `DONE` — baseline inventory + EXPECTED flow auth-step loss |
| S1.4 | Config security heuristics (CORS/JWT/cookies/headers) | `DONE` — `detectConfigSecurity` |
| S1.5 | Propose→sandbox→security-test→verify loop | `DONE` — propose draft + `verifySentinelFinding` (re-scan/advisory/auth markers); apply HIGH blocked via remediation gates |
| S1.6 | UI `/sentinel` או טאב ב־`/truth` + Oracle | `DONE` — `/sentinel` + nav + Truth Sentinel chips |
| S1.7 | Specialist packs: Web · API · Cloud · Identity · DB · AI-security | `DONE` — `runSpecialistPacks` · scan counts · UI chip |

**סדר מומלץ:** S1.1 → S1.3 → S1.2 → S1.4 → S1.5 → S1.6 → S1.7  
**למה S1.3 מוקדם:** Security Regression על Temporal = בידול אמיתי מול SAST חד־פעמי.

**תלות:** P0 Graph/Temporal · P1.2 Security Graph · P1.1 remediation · G5 לפני auto-apply רחב.

---

## GTM / Business (במקביל ל־P0.10+)

| # | משימה | סטטוס |
|---:|---|---|
| G1 | 3–5 Design Partners (repos אמיתיים) | `READY` — pack + tracker; outreach = human |
| G2 | Early Access agreement + feedback loop | `PARTIAL` — playbook + [`early-access-agreement-draft.md`](./early-access-agreement-draft.md) (counsel) |
| G3 | Willingness-to-pay interviews | `READY` — [`willingness-to-pay-interviews.md`](./willingness-to-pay-interviews.md); interviews = human |
| G4 | Paid Beta | `READY` — [`paid-beta-checklist.md`](./paid-beta-checklist.md); ops = human |
| G5 | Security hardening review לפני scale | `DONE` — project ownership writes · isolation audit · CI secret scan · graph policy · expanded advisories |

---

## Definition of Done — “TRUTH-10 MVP”

נחשב **ירוק** רק כשכל אלה נכונים:

1. Graph v0 נבנה מ־workspace ומוחזר ב־API (לא מערך ריק).  
2. שינוי ב־flow (למשל payment אחרי confirm) → Behavioral Drift + Risk + Evidence.  
3. Impact מראה תלויות transitive מ־Graph.  
4. מסך `/truth` מציג Health אחד + finding החשוב ביותר.  
5. לפחות cycle אחד נשמר בהיסטוריה (snapshot).  
6. אין “AI חזק בלי ראיה” ב־UI הראשי.  
7. **Sentinel:** observe cycle מזרים SECURITY findings + PACKAGE/advisory graph + Truth chips + verify engine נפרד.

**סטטוס:** ✅ TRUTH-10 MVP Proof + Sentinel (incl. S1.7 packs) + G5 + Oracle Sentinel feed + G3/G4 READY packs = **engineering bar closed**. Human-only leftovers: outreach interviews · Paid Beta ops · patents.

---

## סדר ביצוע מומלץ (ספרינטים)

```
Sprint A (עכשיו)
  0.3 Graph v0 → 0.4 Impact → 0.5 Observer sync → 0.10 /truth dashboard

Sprint B
  0.6 Expected model → 0.7/0.8 Evidence+Risk graph-aware → 0.11 history

Sprint C
  0.9 Continuous hooks → 0.12 DP counters → G1 partners
```

---

## Change log

| תאריך | שינוי |
|---|---|
| 2026-08-13 | נוצר **ATLAS TRUTH-10**; Observer MVP סומן DONE; Graph v0 + /truth התחילו |
| 2026-08-13 | Observer package + API + UI נשלחו קודם בשיחה זו |
| 2026-08-13 | Graph v0 + Impact API + Observer sync + `/truth` ATLAS HEALTH — Sprint A סגור חלקית |
| 2026-08-13 | **Sprint B / P0 ירוק:** EXPECTED model · evidenceRefs · graph-aware risk · webhook observe · cycle history · DP counters |
| 2026-08-13 | Bugfix: no golden fallback for linked projects; resilient observer GET; top-finding filter; Security/ADR graph seeds |
| 2026-08-13 | P1.3/1.4: production signals + ADR conflict detect; deploy feeds trigger observe |
| 2026-08-13 | **0.6 harden:** Expected GET/PUT + Truth EXPECTED vs OBSERVED; **0.11:** genome snapshots API+UI; **G1 pack** `design-partner-truth10-early-access.md` |
| 2026-08-13 | **P1 surface:** `/truth` מציג Security/ADR/Production signals; top finding כולל adr-conflict; isolation claim |
| 2026-08-13 | **P1.6:** webhook → observe → GitHub Check Run `Atlas Truth` (`checks:write`) |
| 2026-08-13 | **P1.2/1.4:** IDENTITY + DATA_STORE chain; DECIDED_BY API↔ADR; put() dedupe |
| 2026-08-13 | **P1.5 messaging:** isolation claim in README + DP Early Access; richer Truth P1 chips |
| 2026-08-13 | **P1.1:** Truth Propose fix → `TRUTH_FIX` note draft (approve→apply→verify; HIGH blocked) |
| 2026-08-13 | **P1.3:** Vercel/Render deploy → `.atlas/production/deploys.json` → DEPLOYMENT nodes + Truth finding |
| 2026-08-13 | **A1 נוסף לרשימה:** Admin Oracle / Command Agent — לוח בקרה + ניטור + בריפינג + סייבר הגנתי ממקורות מורשים |
| 2026-08-13 | **A1.1:** `/admin/oracle` shell + API persona/allowlist/brief scaffold |
| 2026-08-13 | **A1.2:** Oracle action queue — detect→rank→notify/propose (watchdog + patches + deploys) |
| 2026-08-13 | **A1.3–A1.7:** version EOL · defensive advisory match · daily brief · audit · morning digest |
| 2026-08-13 | **S1 נועל:** Atlas Sentinel — Defensive Security Agent (לא תקיפה); Security Verification Loop + S1.1–S1.7 |
| 2026-08-13 | **S1.1/S1.3/S1.6:** secret detect + authz regression · `/sentinel` · nav · agent Sentinel knowledge |
| 2026-08-13 | **S1.2/S1.4/S1.5:** deps advisories · config heuristics · propose + verify re-scan |
| 2026-08-13 | **Sentinel 10/10:** cycle ingest · Graph PACKAGE/INCIDENT · Temporal AuthZ baseline · Truth surface · verify engine |
| 2026-08-13 | **G5/P1.2/P1.5:** project ownership writes · isolation audit · Security Graph policy · CI secret scan · expanded advisories |
| 2026-08-13 | **Closeout:** S1.7 specialist packs · Oracle←Sentinel · prod/ADR harden · G3/G4/WTP + Paid Beta packs · seed narrative · benchmarking seed |
| 2026-08-13 | **P1/A1/P2 deepen:** re-observe verify · failed-deploy INCIDENT · DECIDED_BY topics · Check Run annotations · Oracle audit/digest persist · truth-benchmark API · EA agreement draft |
| 2026-08-15 | **P2.8:** Managed System layer — Truth/Control Plane over connectors; `/systems`; Atlas-self; no rewrite |
| 2026-08-15 | **P2.8b bind:** real facets · persisted contract + invariant verify · ACT ownership · no prod auto-apply · Systems command path · Audit offer copy |

---

## קישור מהיר לקוד

| נושא | Path |
|---|---|
| Observer | `packages/observer` |
| Evidence | `packages/shared/src/schemas/evidence.schema.ts` |
| Graph schema | `packages/shared/src/schemas/graph.schema.ts` |
| Graph API | `apps/api/src/routes/graph.ts` |
| Expected API | `GET/PUT /api/v1/projects/:id/observer/expected` |
| Snapshots API | `GET /api/v1/projects/:id/observer/snapshots` |
| Health (ישן/מקביל) | `apps/web/app/[locale]/health` |
| Managed Systems | `packages/system-model` · `/systems` · `/systems/:id` · `GET /api/v1/systems` · `GET|PUT /api/v1/systems/:id/contract` |
| Truth dashboard | `apps/web/app/[locale]/truth` |
| Admin Oracle | `/admin/oracle` · סעיף **A1** |
| Atlas Sentinel | `/sentinel` · `packages/observer/src/security` · `GET/POST …/sentinel` · סעיף **S1** |
| G3 WTP | `docs/strategy/willingness-to-pay-interviews.md` |
| G4 Paid Beta | `docs/strategy/paid-beta-checklist.md` |
| G2 EA draft | `docs/strategy/early-access-agreement-draft.md` |
| Truth benchmark | `GET /api/v1/portfolio/truth-benchmark` |
| Design partners | `docs/strategy/design-partner-playbook.md` |
| TRUTH-10 Early Access (G1) | `docs/strategy/design-partner-truth10-early-access.md` |
