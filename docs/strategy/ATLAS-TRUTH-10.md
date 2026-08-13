# ATLAS TRUTH-10

**שם לזכור:** `TRUTH-10`  
**קובץ זה:** `docs/strategy/ATLAS-TRUTH-10.md`  
**סטטוס:** Living — מתעדכן בכל התקדמות  
**עדכון אחרון:** 2026-08-13 (P1.6 Truth Check Runs)  
**מטרת ציון:** **10/10** — Software Intelligence Platform (לא עוד כלי AI)

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
| **מה אנחנו** | שכבת אמת הנדסית מעל Git / CI / Runtime / החלטות |
| **מה אנחנו לא** | IDE · chatbot · “AI שעושה הכול” · אוסף SAST |
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
| 1.1 | Autonomous Remediation (propose→test→verify→approve) | `PARTIAL` — gated LOW קיים; לא להרחיב ל־prod auto |
| 1.2 | Security Graph (identity→API→data) | `PARTIAL` — edges + finding + **Truth strip**; עדיין לא identity→API→data מלא |
| 1.3 | Production Intelligence (logs/traces/metrics) | `PARTIAL` — repo probes + deploy→observe + **Truth strip**; לא APM חי |
| 1.4 | Engineering Memory ↔ Graph (ADR conflicts) | `PARTIAL` — conflict detect + **top finding** ב־`/truth` |
| 1.5 | Isolation / no cross-tenant learning (product claim + controls) | `PARTIAL` — claim על `/truth` + BYO; audit controls עדיין חלשים |
| 1.6 | CI/CD deep integrations | `PARTIAL` — webhook observe + **Atlas Truth Check Run** (דורש `checks:write` באפליקציית GitHub) |

---

## P2 — רק אחרי בסיס ירוק

| # | משימה | סטטוס |
|---:|---|---|
| 2.1 | Multi-agent specialists (Architect, Runtime, Security…) | `PARTIAL` — Fabric קיים; לא להרחיב |
| 2.2 | Benchmarking versions/teams | `OPEN` |
| 2.3 | Patent landscape / Trademark Atlas | `OPEN` — משפטי, לא קוד |
| 2.4 | Pricing experiments (repos/seats) | `PARTIAL` — freemium usage היום |
| 2.5 | Case studies + Seed narrative | `OPEN` |

---

## GTM / Business (במקביל ל־P0.10+)

| # | משימה | סטטוס |
|---:|---|---|
| G1 | 3–5 Design Partners (repos אמיתיים) | `READY` — pack + tracker; outreach = human |
| G2 | Early Access agreement + feedback loop | `PARTIAL` — playbook + Truth-10 Early Access |
| G3 | Willingness-to-pay interviews | `OPEN` |
| G4 | Paid Beta | `OPEN` |
| G5 | Security hardening review לפני scale | `OPEN` |

---

## Definition of Done — “TRUTH-10 MVP”

נחשב **ירוק** רק כשכל אלה נכונים:

1. Graph v0 נבנה מ־workspace ומוחזר ב־API (לא מערך ריק).  
2. שינוי ב־flow (למשל payment אחרי confirm) → Behavioral Drift + Risk + Evidence.  
3. Impact מראה תלויות transitive מ־Graph.  
4. מסך `/truth` מציג Health אחד + finding החשוב ביותר.  
5. לפחות cycle אחד נשמר בהיסטוריה (snapshot).  
6. אין “AI חזק בלי ראיה” ב־UI הראשי.

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
| Truth dashboard | `apps/web/app/[locale]/truth` |
| Design partners | `docs/strategy/design-partner-playbook.md` |
| TRUTH-10 Early Access (G1) | `docs/strategy/design-partner-truth10-early-access.md` |
