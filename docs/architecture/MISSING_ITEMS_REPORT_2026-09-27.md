# ArletOS — דוח פערים מלא
## מה שלא נגמר, מה שחסר, מה שממתין לאישור

**תאריך:** 2026-09-27  
**מצב:** טיוטה — ממתינה לאישור ארלט  
**מקורות:** ARLETOS_MASTER_PROBLEM_REGISTER.md (HEAD `aaa75f6`), studio-web-future-direction-2026-09-25.md (FD), Master Register §6, §7, §9, §11, §12  
**הערת התאמה:** Reconciliation performed against verified repository state at aaa75f6 (2026-09-27). SHA 6e0d96a was not found in the audited repository. Baseline updated from d3b3ec4 to aaa75f6.  
**כלל:** כל פריט מבוסס על ראיות במסמכים. שום דבר לא הומצא.

---

## 0. סיכום מנהלים

| קטגוריה | מספר פריטים | חומרה |
|---|---|---|
| פערי מוצר פתוחים (§6 רגיסטר) | 5 | HIGH / CRITICAL |
| פונקציות קיימות לא מחוברות ל-UI | 7 | MEDIUM–HIGH |
| פעולות UI חסרות לחלוטין | 9 | MEDIUM–HIGH |
| החלטות אדם ממתינות | 8 | BLOCKER |
| חסמי סביבה | 4 | ENVIRONMENT |
| פערי תיעוד | 3 | LOW |

**סה"כ פריטים פתוחים: 36**

---

## 1. פערי מוצר פתוחים — §6 (ARL-WS-001 עד ARL-WS-007)

### 1.1 ARL-WS-001 — זרימת דחיית Patch (REJECTION)
**סטטוס:** 🟠 IMPLEMENTED — RUNTIME BLOCKED (ENVIRONMENT)  
**קישור להחלטה:** D4 (אושרה 2026-09-26)

**ראיות inspect + implement (2026-09-27):**

| שכבה | קובץ | שורות | מצב |
|------|------|--------|------|
| Route | `apps/api/src/routes/code.ts` | 997 | EXISTING — `POST /api/v1/code/patches/:id/reject` |
| Service | `apps/api/src/services/patch-write.ts` | 162–201 | EXISTING — `rejectPatchArtifact()`: status→REJECTED, rejection.{by,userId,at,reason}, audit `code.patch.rejected` |
| REJECTABLE_STATUSES | `apps/api/src/services/patch-write.ts` | 75–81 | EXISTING — DRAFT, PROPOSED, EVALUATED, AWAITING_APPROVAL, APPROVED |
| Schema | `packages/shared/src/schemas/patch.schema.ts` | 141–149, 202–204 | EXISTING — `rejection` field, `rejectPatchSchema` (reason min 1 max 2000) |
| Store | `apps/api/src/store/os-store.ts` | 1418–1425 | EXISTING — `listPatches` מחזיר ALL patches כולל REJECTED (ללא פילטר) |
| Correction route | `apps/api/src/routes/code.ts` | 1469–1480 | EXISTING — POST /patches validates `supersedesPatchId` references REJECTED patch same project |
| ask-agent supersedesPatchId | `apps/api/src/routes/code.ts` | 231–274 | **IMPLEMENTED 2026-09-27** — ask-agent body מקבל `supersedesPatchId`, מאמת REJECTED, מעביר ל-createProposal ול-patch artifact |
| proposeBody schema | `apps/api/src/routes/code.ts` | 112–121 | **IMPLEMENTED 2026-09-27** — הוספת `supersedesPatchId: z.string().uuid().optional()` |
| createProposal patch | `apps/api/src/routes/code.ts` | 888–900 | **IMPLEMENTED 2026-09-27** — `supersedesPatchId` נוסף לאובייקט ה-patch שנוצר |
| UI: rejection alert | `apps/web/components/studio/StudioPatchWorkflow.tsx` | 364–383 | EXISTING+CONNECTED — מציג Alert + כפתור "Propose correction" |
| UI: reject button | `apps/web/components/studio/StudioPatchWorkflow.tsx` | 516–534 | EXISTING — כפתור + reason textarea |
| UI: rejected history | `apps/web/components/studio/StudioPatchWorkflow.tsx` | 541–592 | **IMPLEMENTED 2026-09-27** — רשימת rejected patches עם כפתור correction לכל אחד |
| canCorrectStudioPatch | `apps/web/lib/studio-patch-workflow.ts` | 65–68 | **IMPLEMENTED 2026-09-27** — gate function, REJECTED→true, כל שאר→false |
| i18n | `apps/web/messages/{en,he,fr,ar}.json` | — | **IMPLEMENTED 2026-09-27** — `proposeCorrection` + `rejectedHistory` ב-4 שפות |
| correctionForPatchId state | `apps/web/app/[locale]/studio/page.tsx` | 334 | **IMPLEMENTED 2026-09-27** — state var לשמירת rejected patch ID |
| propose mutation | `apps/web/app/[locale]/studio/page.tsx` | 601–622 | **IMPLEMENTED 2026-09-27** — `supersedesPatchId` מועבר ל-ask-agent כשיש correctionForPatchId |
| onCorrect connected | `apps/web/app/[locale]/studio/page.tsx` | 1611–1617 | **IMPLEMENTED 2026-09-27** — `onCorrect` callback מחובר, מציב correctionForPatchId ומעבר ל-intent=propose |

**בדיקות שרצו (2026-09-27) — ROUND 2 אחרי כל ה-implementation:**

| בדיקה | פקודה | תוצאה |
|-------|-------|--------|
| studio-patch-workflow unit (כולל 3 tests חדשים D4) | `npx vitest run apps/web/lib/studio-patch-workflow.test.ts` | **7/7 PASS** |
| patch-write unit | `npx vitest run apps/api/src/services/patch-write.test.ts` | **2/2 PASS** |
| Stage 5 D4 rejection (golden loop) | `npx vitest run apps/api/src/routes/stage5-golden-loop.test.ts` | **21/21 PASS** |
| TypeScript — apps/web | `tsc --noEmit` (apps/web) | **CLEAN** |
| TypeScript — apps/api (code.ts) | `tsc --noEmit` (apps/api) | **CLEAN בקובץ code.ts** — שגיאות pre-existing בtest fixtures (emailVerified) לא קשורות לשינויים |

**בירור פער ראיות בדיקות ("@atlas/database resolution error" vs "2/2 PASS"):**  
סיבת הפער: packages לא היו built בתחילת הסשן. `@atlas/database` (ו-`@atlas/shared`, `@atlas/code-intelligence`) דרשו build לפני שvitest יכול לפתור imports. לאחר build (`pnpm --filter @atlas/database build` וכו') — הבדיקות עוברות 2/2. זהו חסם סביבה/workspace, לא defect במוצר. **לא בוצעו שינויי dependencies.**

**קבצים שהשתנו (שלב נוכחי):**
- `apps/api/src/routes/code.ts` — ask-agent + proposeBody + createProposal: supersedesPatchId support
- `apps/web/lib/studio-patch-workflow.ts` — canCorrectStudioPatch()
- `apps/web/lib/studio-patch-workflow.test.ts` — 3 focused D4 tests חדשים
- `apps/web/components/studio/StudioPatchWorkflow.tsx` — canCorrectStudioPatch import + rejected history UI
- `apps/web/app/[locale]/studio/page.tsx` — correctionForPatchId state + propose mutation + onCorrect prop
- `apps/web/messages/{en,he,fr,ar}.json` — rejectedHistory key (4 שפות)

**אין שינוי ב:**
- `apps/api/src/services/governed-command.ts` (protected)
- `dispatch.ts` (protected)
- `e2e/new-surfaces.spec.ts` (protected)
- `cookies.txt` (protected)
- backend services, schemas, store

**טבלת ראיות ARL-WS-001 — VERIFICATION ROUND 3 (2026-09-27):**

| Requirement | Evidence | Result |
|---|---|---|
| Rejected patch appears in history | `StudioPatchWorkflow.tsx` lines 544–591: filters `items` by `status === "REJECTED"`, renders history section. `stage5-golden-loop.test.ts` test "D4: correction proposal supersedes a rejected patch" creates REJECTED patch and verifies field. | ✅ PASS (code+test) |
| Correction action available | `canCorrectStudioPatch(p.status)` gate in history UI (line 567). Only renders Button when `status === "REJECTED"`. Tests: 7/7 PASS incl. `exposes correction action only for REJECTED patches`. | ✅ PASS (code+test) |
| correctionForPatchId retained | `useState<string | null>(null)` at line 334 of studio/page.tsx. `onCorrect` callback: `setCorrectionForPatchId(rejectedPatchId); setIntent("propose")`. Cleared on `onSuccess`: `setCorrectionForPatchId(null)`. | ✅ PASS (code review) |
| ask-agent receives supersedesPatchId | propose mutation (page.tsx line 614): `...(correctionForPatchId ? { supersedesPatchId: correctionForPatchId } : {})`. ask-agent body schema (code.ts line 245): `supersedesPatchId: z.string().uuid().optional()`. | ✅ PASS (code review) |
| new patch created | `createProposal` in code.ts line 910: `...(body.supersedesPatchId ? { supersedesPatchId: body.supersedesPatchId } : {})` included in `patchArtifactSchema.parse({...})`. `stage5-golden-loop.test.ts`: verifies `correctionPatch !== undefined`. | ✅ PASS (code+test) |
| new patch supersedes rejected patch | `stage5-golden-loop.test.ts` line ~490: `expect(correctionPatch.supersedesPatchId).toBe(rejectedPatch.id)`. POST /patches also validates and persists (lines 1493–1549). | ✅ PASS (test) |
| source remains REJECTED | `stage5-golden-loop.test.ts`: verifies original patch status unchanged. `rejectPatchArtifact()` sets status=REJECTED terminally. No code path changes REJECTED→anything else. | ✅ PASS (code+test) |
| normal approval lifecycle retained | correction patch enters normal lifecycle — no auto-approve, no auto-apply, no governance bypass. Verified by `canApplyStudioPatch`, `canApproveStudioPatch` gates unchanged. stage5-golden-loop.test.ts 21/21 PASS. | ✅ PASS (code+test) |
| cross-project rejection enforced | ask-agent validation (code.ts lines 261–271): `rejected.projectId !== body.projectId` → 400. POST /patches (lines 1493–1501): same check. `stage5-golden-loop.test.ts` "D4: cross-tenant correction is rejected". | ✅ PASS (code+test) |
| non-REJECTED correction blocked | ask-agent (code.ts lines 264–269): `rejected.status !== "REJECTED"` → 409. `canCorrectStudioPatch` returns false for all non-REJECTED. Tests: `studio-patch-workflow.test.ts` 7/7. | ✅ PASS (code+test) |

**אוטומטד טסטים — ROUND 3 (2026-09-27):**

| בדיקה | תוצאה |
|-------|--------|
| `studio-patch-workflow.test.ts` | **7/7 PASS** |
| `patch-write.test.ts` | **2/2 PASS** |
| `stage5-golden-loop.test.ts` | **21/21 PASS** |
| `studio-remediation-truth.test.ts` | **6/6 PASS** |
| TypeScript apps/web | **CLEAN** |
| TypeScript apps/api (code.ts) | **CLEAN** |

**Runtime Verification — ROUND 4 (2026-09-27) — ENVIRONMENT DIAGNOSIS:**

בדיקה מלאה של כל קבצי `.env` ותשתיות runtime:

| משאב | מצב |
|------|------|
| `.env` / `.env.local` / `.env.development` / `.env.test` | **MISSING** — לא קיים בשום variant |
| `apps/api/.env` | **MISSING** |
| `apps/web/.env` | **MISSING** |
| `supabase` CLI | **NOT INSTALLED** |
| Docker daemon | **NOT RUNNING** (unix socket לא קיים) |
| `supabase/config.toml` | קיים — אך Supabase CLI אינו מותקן |

**משתני סביבה נדרשים (mandatory per `packages/config/src/env.ts`):**

```
DATABASE_URL         — z.string().min(1)         — MISSING
SUPABASE_URL         — z.string().url()           — MISSING
SUPABASE_ANON_KEY    — z.string().min(1)          — MISSING
SUPABASE_SERVICE_ROLE_KEY — z.string().min(1)     — MISSING
ENCRYPTION_KEY       — z.string().min(32)         — MISSING
COOKIE_SECRET        — z.string().min(32)         — MISSING
```

`loadServerEnv()` ב-`apps/api/src/main.ts` מחייב את כל אלה ב-startup — ללא אחד מהם השרת לא עולה.

**מסקנה:** לא ניתן להפעיל שרת API. לא ניתן להפעיל browser/UI. Runtime verification בלתי אפשרית בסביבה הנוכחית.

**BLOCKER CLASSIFICATION:**
```
TYPE: ENVIRONMENT BLOCKER
REASON: Missing runtime infrastructure — no .env, no DB, no Supabase credentials, Docker not running
WHY NOT PRODUCT DEFECT: All automated tests (36/36) pass. TypeScript CLEAN. Implementation verified by code review.
WHAT WAS VERIFIED: unit tests + integration tests + contract tests + TypeScript
WHAT COULD NOT BE VERIFIED: browser/network/runtime (server cannot start)
WHAT IS REQUIRED TO UNBLOCK: .env with DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, COOKIE_SECRET — or working Supabase/Docker environment
```

**טבלת runtime scenarios (CASE B — environment blocked):**

| Scenario | Evidence | Result |
|---|---|---|
| Rejected history visible | ❌ Server cannot start | BLOCKED |
| Rejection details | ❌ Server cannot start | BLOCKED |
| Correction action | ❌ Server cannot start | BLOCKED |
| ask-agent request | ❌ No server | BLOCKED |
| supersedesPatchId in request | ❌ No server | BLOCKED |
| New patch created | ❌ No server | BLOCKED |
| Original remains REJECTED | ✅ Code+test (stage5-golden-loop 21/21) | PASS (test only) |
| Non-REJECTED correction blocked | ✅ Code+test (studio-patch-workflow 7/7) | PASS (test only) |
| Cross-project blocked | ✅ Code+test (stage5-golden-loop) | PASS (test only) |
| Governance preserved | ✅ Code review — no bypass paths | PASS (code only) |

**סיווג סופי (Round 4):**

```
STATUS: IMPLEMENTED — RUNTIME BLOCKED (ENVIRONMENT)
```

הסיבה: כל שכבות ה-D4 contract מיושמות ונבדקות (code review + 36/36 automated tests). חסם runtime: אין `.env`, אין Docker/Supabase, אין credentials. זהו ENVIRONMENT BLOCKER — לא Product Defect.

---

**Runtime Verification — ROUND 5 (2026-09-27) — RE-VERIFICATION לאחר הכנת DB:**

ארלט ציינה שה-DB/Supabase הוכנו. בוצע ניסיון re-verification בסביבת הריצה הנוכחית.

**startup attempt (exact command):** `npx tsx apps/api/src/main.ts`

**exact server error:**
```json
{"level":"error","message":"CONFIG_ERROR: Invalid server environment: DATABASE_URL: Required; SUPABASE_URL: Required; SUPABASE_ANON_KEY: Required; SUPABASE_SERVICE_ROLE_KEY: Required; ENCRYPTION_KEY: Required; COOKIE_SECRET: Required","service":"atlas-api"}
```

**root cause:** `loadServerEnv()` מריץ Zod validation בעת startup — כל 6 שדות חובה חסרים.

| משאב | מצב Round 5 |
|------|------|
| `.env` / `apps/api/.env` / `apps/web/.env` | **MISSING** — אין בשום מיקום |
| `DATABASE_URL` בפרוצס | **MISSING** |
| `SUPABASE_URL` בפרוצס | **MISSING** |
| `SUPABASE_ANON_KEY` בפרוצס | **MISSING** |
| `SUPABASE_SERVICE_ROLE_KEY` בפרוצס | **MISSING** |
| `ENCRYPTION_KEY` בפרוצס | **MISSING** |
| `COOKIE_SECRET` בפרוצס | **MISSING** |
| Docker daemon | **NOT RUNNING** |
| supabase CLI | **NOT INSTALLED** |
| Server: | **DID NOT START** |
| Browser verification: | **NOT POSSIBLE** |
| Network evidence: | **NOT AVAILABLE** |

**הסבר:** ייתכן שהכנת ה-DB בוצעה בסביבה אחרת (מכונה מקומית / Render / Vercel) ולא הועברה ל-container הנוכחי. ה-container הנוכחי אינו מקבל variables מסביבה חיצונית — לא נמצאו `.env` files ולא process env vars.

**מה נדרש לביצוע runtime verification:**
- `.env` מאוכלס עם 6 המשתנים הנדרשים, **בתוך** סביבת הריצה של container זה
- או: הרצת הפרויקט על מכונה שבה ה-DB מוגדר ומשתני הסביבה נגישים

**סיווג Round 5:**
```
STATUS: IMPLEMENTED — RUNTIME BLOCKED (ENVIRONMENT)
REASON: Server cannot start — CONFIG_ERROR on 6 required env vars missing in this container.
BROWSER VERIFICATION: NOT POSSIBLE
NOT A PRODUCT DEFECT.
```

---

**Runtime Reconciliation — ROUND 6 (2026-09-27) — OFFICIAL RUNTIME IDENTIFIED:**

| Question | Evidence | Result |
|---|---|---|
| Does repo define official runtime? | `README.md` §Quick start: `cp .env.example .env && supabase start && pnpm dev`; `deploy/bootstrap.sh`: Ubuntu 24.04 VM + systemd + `/etc/atlas/*.env` | YES |
| Does repo define DB source? | `apps/api/.env.example` line 8: `DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres` (dev=local Supabase); `deploy/env/worker.env.example`: DATABASE_URL= (production = VM-injected) | YES |
| Does repo define Supabase source? | `apps/api/.env.example`: `SUPABASE_URL=http://127.0.0.1:54321` (dev); `deploy/validate-production-env.sh`: reads `/etc/atlas/*.env` (production) | YES |
| Is runtime secret injection documented? | `README.md`: `cp .env.example .env` → fill manually (dev). `deploy/bootstrap.sh` + `deploy/validate-production-env.sh`: `/etc/atlas/*.env` never overwritten (production) | YES |
| Does current container receive configuration? | `echo $DATABASE_URL` → empty. All 6 vars: NOT SET. No `.env` in any location. | NO |
| Is DB existence verified? | Supabase screenshot: `cfdqhsvriyxhsmhvnzgx.supabase.co` Status: Healthy, Singapore ap-southeast-1 | YES (external infra) |
| Is Supabase availability verified? | Same screenshot: Project "taqonu", Status: Healthy | YES (external infra) |
| Is the current container the intended verification runtime? | Official dev runtime = local machine + Docker + `supabase start`. Official production = Ubuntu 24.04 VM + bootstrap.sh. This container = neither. | NO |

**OFFICIAL DEVELOPMENT RUNTIME:** Local machine (Windows) + Docker + `supabase start` (ports 54321/54322) + `cp .env.example .env` (fill `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) + `pnpm dev`

**OFFICIAL VERIFICATION RUNTIME:** Same as development — or CI with injected secrets

**OFFICIAL PRODUCTION RUNTIME:** Ubuntu 24.04 VM (`deploy/bootstrap.sh`) + systemd services (atlas-control-plane :3100, atlas-admin :3200, atlas-worker) + `/etc/atlas/*.env` (owner-managed, never overwritten by bootstrap)

**Variable status in this container:**

| Variable | Declared in repo | Example documented | Injection mechanism identified | Actual value in current runtime |
|---|---|---|---|---|
| DATABASE_URL | YES (`packages/config/src/env.ts` line 19) | YES (`apps/api/.env.example`) | YES (`.env` file / `/etc/atlas/worker.env`) | NO |
| SUPABASE_URL | YES (line 20) | YES (`apps/api/.env.example`) | YES | NO |
| SUPABASE_ANON_KEY | YES (line 21) | YES (replace-me) | YES | NO |
| SUPABASE_SERVICE_ROLE_KEY | YES (line 22) | YES (replace-me) | YES | NO |
| ENCRYPTION_KEY | YES (line 24) | YES (placeholder 32-char) | YES | NO |
| COOKIE_SECRET | YES (line 25) | YES (placeholder 32-char) | YES | NO |

**FINAL CLASSIFICATION — ROUND 6:**
```
RUNTIME CONFIGURATION SOURCE IDENTIFIED — CREDENTIAL INJECTION BLOCKED
```

Infrastructure (Supabase at cfdqhsvriyxhsmhvnzgx.supabase.co): EXISTS — HEALTHY  
Credential injection into this cloud container: BLOCKED — no .env, no process env vars  
DB existence: NOT DISPROVED — infra confirmed healthy externally  
This container: NOT the intended runtime (not local dev machine, not Ubuntu VM)

---

### 1.2 ARL-WS-002 — פעולות קובץ ב-Studio (חסרות/לא מאומתות)
**סטטוס:** ✅ IMPLEMENTED — UNIT TESTED (48/48 PASS) — RUNTIME BLOCKED (ENVIRONMENT)  
**קישור להחלטה:** D3 (אושרה 2026-09-26)  
**תאריך implementation:** 2026-09-27

**מה קיים בקוד (קודם לימוש):**
- `POST /api/v1/studio/file/move` — העברת קובץ, יוצר parent folders
- Overwrite על move נחסם (קובץ קיים ביעד נדחה)
- Agent-actor נחסם ב-PUT ובmove (Stage 4 S4-7)
- Atlas-self boundary מיושם

**מה בוצע ב-2026-09-27 (ARL-WS-002):**

| שכבה | קובץ | מה נוסף |
|------|------|---------|
| Logic | `packages/code-intelligence/src/workspace-browser.ts` | `createWorkspaceFolder()` — יוצר תיקייה, throws אם קיימת |
| Logic | `packages/code-intelligence/src/workspace-browser.ts` | `deleteWorkspaceFile()` — מוחק קובץ יחיד, throws אם לא קיים/לא קובץ |
| Logic | `packages/code-intelligence/src/workspace-browser.ts` | `deleteWorkspaceFolder()` — מוחק תיקייה ריקה בלבד, throws אם לא ריקה |
| Route | `apps/api/src/routes/code.ts` | `POST /api/v1/studio/folder` — human-only, agent FORBIDDEN |
| Route | `apps/api/src/routes/code.ts` | `DELETE /api/v1/studio/file` — human-only, Atlas-self boundary enforced |
| Route | `apps/api/src/routes/code.ts` | `DELETE /api/v1/studio/folder` — human-only, empty-only |
| Tests | `apps/api/src/routes/studio-write.test.ts` | 9 tests חדשים — ARL-WS-002 describe block |

**ראיות טסטים (2026-09-27):**

| בדיקה | תוצאה |
|---|---|
| POST /studio/folder — creates folder | 200 ✅ |
| POST /studio/folder — already exists | 400 ✅ |
| POST /studio/folder — agent actor | 403 ✅ |
| DELETE /studio/file — deletes file | 200 ✅ |
| DELETE /studio/file — nonexistent | 400 ✅ |
| DELETE /studio/file — agent actor | 403 ✅ |
| DELETE /studio/folder — empty folder | 200 ✅ |
| DELETE /studio/folder — non-empty | 400 ✅ |
| DELETE /studio/folder — agent actor | 403 ✅ |
| סה"כ studio-write.test.ts | **48/48 PASS** |

**Governance decisions baked in:**
- יצירת תיקייה: throws אם קיים (file or directory) — אין silent replace
- מחיקת קובץ: throws אם לא קיים — explicit error only
- מחיקת תיקייה: throws אם לא ריקה — D3: אין recursive delete
- כל שלושת ה-routes: `AGENT` → 403 (human-only, כ-PUT/move)
- Atlas-self boundary: enforced ב-DELETE /studio/file (אותו מנגנון כ-PUT)

**Runtime:** BLOCKED — אין `.env`/Docker/Supabase בcontainer זה (זהה ל-ARL-WS-001).

---

### 1.3 ARL-WS-003 — קריטריון סיום ל-UNDERSTAND
**סטטוס:** ✅ IMPLEMENTED + TESTED — D2 closure pass (2026-09-28)  
**קישור להחלטה:** D2  

**מה קיים:**
- Guardian מציב BLOCK על: missing target, CONFLICT, INSUFFICIENT_EVIDENCE (Stage 4/5)
- UNKNOWN → UNVERIFIED (Stage 5 G-4)
- `patchUnderstanding` נשמר על ה-patch artifact
- **[2026-09-28] D2-2 יושם:** UNVERIFIED → gate=BLOCKED (לא PROCEED). code.ts שורות 981–985.
- **[2026-09-28] D2-3 יושם:** INFERRED לא מוקצה ב-patchUnderstanding block.
- **[2026-09-28] D2-1 יושם — Option Y (post-approval promotion):** `approvePatchArtifact` ב-`patch-write.ts` מקדם `understanding.epistemicState` מ-OBSERVED ל-VERIFIED בעת אישור אנושי מפורש דרך `patchArtifact.approvals[]`. רשומת האישור (`by + userId + at`) היא הראיה האנושית האוטנטית. ציון confidence לא נבדק לצורך VERIFIED. UNVERIFIED / CONFLICTED / INSUFFICIENT_EVIDENCE אינם מקודמים על ידי approval.

**בדיקות (2026-09-28):** stage5-golden-loop.test.ts: **27 passed / 0 failed**.
- D2-1: `VERIFIED epistemicState must not be produced by a confidence score alone` ✅
- D2-1 (Y): `explicit human approval via approvals[] promotes OBSERVED understanding to VERIFIED` ✅
- D2-1 (Y): `without approval, understanding remains OBSERVED and is not VERIFIED` ✅
- D2-1 (Y): `UNVERIFIED understanding is NOT promoted to VERIFIED by approval (only OBSERVED qualifies)` ✅
- D2-2: `UNVERIFIED understanding blocks the proposal` ✅
- D2-3: `patchUnderstanding never assigns INFERRED` ✅

**קבצים שהשתנו עבור D2:**
- `apps/api/src/services/patch-write.ts` — D2-1 Y: OBSERVED→VERIFIED promotion ב-`approvePatchArtifact`
- `apps/api/src/routes/code.ts` — D2-2: UNVERIFIED→BLOCKED; D2-3: no INFERRED in patchUnderstanding
- `apps/api/src/routes/stage5-golden-loop.test.ts` — 27 בדיקות D2

**ממתין (לא חוסם סגירה):**
- אין ספים מספריים שמגדירים "UNDERSTAND הצליח" — זוהי פריט פתוח נפרד, לא חלק מחוזה D2.
- אין diagnostics + symbols כחלק מ-UNDERSTAND record — פריט פתוח נפרד.

---

### 1.4 ARL-WS-004 — ידע שגיאות של Personal Agent
**סטטוס:** 🟡 **IMPLEMENTED + TESTED — RUNTIME UNVERIFIED** (verification gate closed 2026-09-28)  
**עדכון:** כל ה-capabilities הושלמו ועברו verification gate מלא (STILL_VALID semantics + cross-tenant successor guard).

**מה קיים (source-verified, runtime-unverified):**
- Error events ב-`DomainEvent` (`evaluation.completed` + `ok=false / patchVerifyStatus=FAIL`)
- `recurring-failure.ts` — קורא, מקבץ לפי signature, מחזיר המלצת `INFERRED` — **לא כותב**
- ✅ **Problem record מתמשך** — `bug-fix-learning.ts → persistValidatedBugFixMemory()` כותב `Memory{type:SOLUTION, epistemicState:OBSERVED}` עם provenance (`bugId+patchId+evidence`)
- ✅ **מניעת duplicate** — `findExistingBugFixMemory()` בודק לפני כל כתיבה (הבדיקה היא באחריות הקורא, לא ב-`commitMemory` עצמו)
- ✅ **שרשרת: failure → fix → evidence → memory** — `patch-write.ts:479` (verify.ok) + `observe-cycle.ts` קוראים ל-`learnFromVerifiedPatch` / `learnFromObserverBugs`
- ✅ **Re-validation** — `revalidateBugFixMemory()` (implemented + verified 2026-09-28): STILL_VALID | STALE | CONFLICTED | SUPERSEDED
- ✅ **Knowledge update כשראיות משתנות** — `revalidateBugFixMemory()` עם semantics מדויקים:
  - `contradicts:false, weakens:false` → **STILL_VALID** (ראיות תומכות — ידע נשאר ללא שינוי)
  - `contradicts:false, weakens:true` → **STALE** (confidence ירד, לא הופרך)
  - `contradicts:true` → **CONFLICTED** (counter-evidence ישיר)
  - `successorMemoryId` (אותו owner) → **SUPERSEDED**
- ✅ **Cross-tenant successor guard** — `successorMemoryId` מאומת תחת אותו `ownerId` לפני supersession. ניסיון להשתמש ב-successor של tenant אחר מחזיר `{outcome:"skipped", reason:"not_found"}`.
- ✅ **Audit** — `osStore.appendAudit("bug.fix.learned" | "bug.fix.revalidated")` + `appendDomainEvent`
- ✅ **הפרדת בעלות** — `agentId:"DEBUGGER"`, `allowedAgents`, `ownerId` ריאלי בלבד; re-validation מוגן tenant-isolation

**D2 compatibility:** `revalidateBugFixMemory` **לעולם לא** מעלה ל-VERIFIED. רק human approval (D2-1) יכול לבצע OBSERVED→VERIFIED.

**בדיקות (2026-09-28):** `bug-fix-learning.test.ts` — **23/23 PASS** (source-level, runtime-unverified). Tests 1–10 + Test 10a (cross-tenant successor guard) + 12 tests מקוריים שמורים. TypeScript: 0 errors (ARL-WS-004 files).

**שרשרת מאומתת ב-source:**
```text
failure (DomainEvent) → verify.ok=true (patch-write.ts)
  → learnFromVerifiedPatch() → persistValidatedBugFixMemory()
    → duplicate check → evidence check → Memory{SOLUTION,OBSERVED} → commitMemory()

Re-validation:
  new evidence → revalidateBugFixMemory()
    → STILL_VALID (supporting, no change)
    | STALE (weakens=true, status=ACTIVE, epistemic=STALE)
    | CONFLICTED (contradicts=true, status=ACTIVE, epistemic=CONFLICTED)
    | SUPERSEDED (successorMemoryId, same owner → status=SUPERSEDED, supersededBy=set)
      → appendAudit("bug.fix.revalidated") + appendDomainEvent
```

**Runtime:** UNVERIFIED / ENVIRONMENT BLOCKER (6 env vars חסרים: DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, COOKIE_SECRET).

---

### 1.5 ARL-WS-005 — Golden Engineering Loop לא הוכח end-to-end
**סטטוס:** 🟡 PARTIALLY IMPLEMENTED (עדכון 2026-09-28)

| שלב | מצב |
|---|---|
| FIND (tree) | ✅ VERIFIED local (Stage 2, Stage 9 historical) |
| FIND (search) | 🟡 IMPLEMENTED_UNVERIFIED — UI exists, not verified |
| FIND (symbols) | 🔴 API only — not surfaced in UI |
| UNDERSTAND | ✅ IMPLEMENTED + TESTED — D2-1/D2-2/D2-3 (2026-09-28, 27/27 PASS). Runtime verification outstanding. |
| ASK (CODE_ENGINEER) | 🕘 HISTORICAL local |
| ASK (PSA) | 🟡 IMPLEMENTED_UNVERIFIED |
| PROPOSE | 🕘 HISTORICAL local |
| REVIEW/DIFF | 🟡 IMPLEMENTED_UNVERIFIED — no runtime evidence, no E2E spec |
| APPROVE/GOVERN | 🕘 HISTORICAL (SoD HTTP). Studio decide UI: 🟡 UNVERIFIED. Reject: ✅ IMPLEMENTED (Stage 5) |
| APPLY | 🕘 HISTORICAL (decider over HTTP) |
| AUDIT | 🕘 HISTORICAL local, API layer |
| RUN/TEST | 🟡 IMPLEMENTED_UNVERIFIED (governed workspace.build, vitest.run) |
| DIAGNOSE | 🟡 PARTIAL — Diagnose button pre-fills CODE_ENGINEER request only |
| CORRECT | ✅ IMPLEMENTED (API layer, 2026-09-28) — `resolveCorrectionContext()`, `supersedesPatchId` link, `correctionContext` in response, `causationId` in audit. UI surface missing. |
| RE-RUN | ✅ IMPLEMENTED (API layer, 2026-09-28) — correction proposal re-runs CODE_ENGINEER agent with prior failure context prepended. UI surface missing. |
| VERIFY | 🕘 HISTORICAL (Studio UI). Rollback: 🕘 HISTORICAL |
| EVIDENCE | 🕘 HISTORICAL local, API layer |

**עדכון 2026-09-28 (ARL-WS-005 implementation pass):**
- קבצים שהשתנו: `apps/api/src/services/patch-write.ts`, `apps/api/src/routes/code.ts`, `apps/api/src/routes/stage5-golden-loop.test.ts`
- סימבולים חדשים: `CorrectionContext`, `resolveCorrectionContext`, `effectiveUserRequest`, `correctionContextBlock`, `causationId` ב-audit
- בדיקות: 14 בדיקות regression חדשות, כל 41 בדיקות בקובץ עוברות
- TypeScript: אפס שגיאות בקבצים שנגענו
- Runtime: ENVIRONMENT BLOCKER — אין DB/env בקונטיינר

**עדכון 2026-09-28 (ARL-WS-005 CONTRACT CLOSURE — causationId final gate):**
- **החלטה: OPTION B** — `causationId` חייב להיות שווה ל-`supersedesPatchId` בכל מסלולי ההגשה כשמדובר בתיקון. הסימטריה בין מסלול ה-agent ל-מסלול הידני נדרשת.
- **שינוי קוד:** `apps/api/src/routes/code.ts` שורה 1789 — `causationId: patch.supersedesPatchId ?? null` נוסף לבלוק ה-audit של `code.patch.submitted` (מסלול ידני בלבד).
- **הבחנה חוזית מתועדת:** `supersedesPatchId` = קישור מודל הנתונים; `causationId` = שרשרת סיבתית ב-audit. עבור תיקונים: `causationId === supersedesPatchId` בהגדרה. אין consumer שמשתמש ב-`causationId` לשאילתות — ה-chain ניתן לשחזור דרך שניהם.
- **בדיקות:** T15 נוסף (describe "ARL-WS-005 causationId symmetry") — manual correction → causationId === supersedesPatchId; non-correction → causationId === null. T14 הורחב עם assertion על causationId.
- **TypeScript:** אפס שגיאות בקבצים שנגענו (code.ts, stage5-golden-loop.test.ts).
- **ARL-WS-005 CONTRACT: CLOSED** — הפער בין causationId ב-agent path לעומת manual path נסגר. CONTRACT DISTINCTION מתועד, לא defect פתוח.

**מה חסר להוכחה מלאה:** runtime verification של CORRECT/RE-RUN, UI surface לתיקון patches דחויים, verification של REVIEW/DIFF ו-RUN/TEST.

---

### 1.6 ARL-WS-007 — מדיניות Commit/Push ב-Studio
**סטטוס:** 🔴 OPEN / 🧭 DECISION_REQUIRED  
**קישור להחלטה:** D5  

**מה קיים:**
- אין `git.commit` ואין `git.push` בקטלוג הפקודות המורשות
- `git.add` מקצה בדיוק נתיב אחד (`pathArg: required`, `["add","--"]`)
- FD §ARL-WS-007 אומר "intentional" — אבל FD הוא כיוון בלבד

**עדכון ממצאי קוד (2026-09-27):** git.commit ו-git.push **קיימים** בקטלוג הפקודות המורשות (`apps/api/src/services/governed-command.ts`). מסווגים כ-HUMAN-ONLY, לא agent-invokable, SoD required. אין UI surface עבורם עדיין. git.commit --no-verify flag הוא החלטת governance לא פתורה — **אין לראות בו כמאושר או כמתוקן**.

**מה נדרש:**  
אישור רשמי שהיעדר UI/surface הוא `INTENTIONALLY_NOT_SUPPORTED` ותיעוד זה ברגיסטר — **או** החלטה לאפשר אותם במסלול מורשה (future planning target בלבד, subject to explicit authorization). git.commit --no-verify must remain an unresolved governance decision.

---

## 2. פונקציות קיימות בקוד — לא מחוברות ל-UI

פריטים אלה **קיימים בקוד** אבל **אינם נגישים מה-UI** של Studio.

### 2.1 PSA Endpoints — לא מחוברים לפאנל
**סיווג:** `EXISTING_CONNECTED — RUNTIME BLOCKED (ENVIRONMENT)`  
**תאריך diagnose:** 2026-09-27

---

#### DIAGNOSE RESULT (2026-09-27)

**1. מי יוצר/מפעיל את PSA:**
- `ensurePersonalSupervisingAgent()` ב-`apps/api/src/services/personal-supervising-agent.ts`
- `SupervisingAgentPanel.tsx` קורא ל-`POST /api/v1/supervising-agent` בעת mount (useEffect + useMutation)
- agentId: `psa:<ownerId>`, agentClass: `PERSONAL_SUPERVISING_AGENT`
- identity נשמרת ב-store (Supabase כשנמצא, אחרת osStore)

**2. איזה API/route משמש את ה-UI:**

| UI Mutation/Query | Route | Service Function |
|---|---|---|
| `psa` query | `GET /api/v1/supervising-agent` | `getPersonalSupervisingAgent(user.id)` |
| `ensure` mutation | `POST /api/v1/supervising-agent` | `ensurePersonalSupervisingAgent(...)` |
| `observation` query | `GET /api/v1/supervising-agent/observation` | `observePersonalSupervisingAgent(user.id)` |
| `memory` query | `GET /api/v1/supervising-agent/memory?projectId=...` | `readPsaMemory(user.id, {...})` |
| `coordinate` mutation | `POST /api/v1/supervising-agent/coordinate` | `coordinateSpecialists(user.id, {...})` |
| `explain` mutation | `POST /api/v1/supervising-agent/explain` | `explainSupervisedRecord(user.id, {...})` |
| `recommend` mutation | `POST /api/v1/supervising-agent/recommend` | `recommendFromPsa(user.id, {...})` |
| `escalate` mutation | `POST /api/v1/supervising-agent/escalate` | `escalateFromPsa(user.id, {...})` |
| `requestAction` mutation | `POST /api/v1/supervising-agent/request` | `requestGovernedAction(user.id, proposal)` |

**3. State שמתקבל ב-frontend:**
- `PsaRecord`: agentClass, agentId, status, recommendations[], escalations[], scope{ownerId, projectIds, applicationIds}
- `PsaObservation`: agentId?, status?, attention[]
- `PsaMemorySlice`: items[], truncated
- `CoordinationPlan`: id?, steps[]{agentId, rationale}
- `{ explanation: string }` מ-explain
- `PsaAttentionRecord` מ-recommend/escalate

**4. Authentication נדרש:**
- `requireSignedInForWrite(app, request)` — בכל 10 ה-routes
- מחלץ user.id מה-session; לא מקבל פניות ללא authenticated user

**5. Project/user context שעובר:**
- `POST /` מקבל `{tenantId, projectIds[], applicationIds[]}` — UI שולח `{tenantId:"user-plane", projectIds:[projectId], applicationIds:["def-000"]}`
- `scopedToProject`: `psa.data?.scope?.projectIds?.includes(projectId)` — gate לmemory query
- `coordinate` ו-`request` מקבלים `projectId` — נבדק ב-service (`assertProjectInScope`)
- `ownerId` = `psa.data?.scope?.ownerId` — מועבר ל-`buildPsaGovernedRequest`

**6. האם UI מחובר ל-backend:**
✅ כן — כל path-ים ב-UI (`/api/v1/supervising-agent/*`) תואמים ל-routes הרשומים ב-`personal-supervising-agent.ts`.  
✅ route registered ב-`create-app.ts` שורה 240.  
✅ types מותאמים (PsaRecord, PsaObservation, PsaMemorySlice).  
✅ `buildPsaGovernedRequest` מאמת `FABRIC_AGENT_IDS`, מוציא request מלא עם evidence.  
✅ `SupervisingAgentPanel` rendered ב-`studio/page.tsx` (line 1376): `<SupervisingAgentPanel projectId={projectId} />`.

**7. Fallback/heuristic path:**
- `bindDurableStore()`: אם SUPABASE_URL חסר — fallback ל-`osStore` (in-memory). כלומר: PSA עובד ב-development/test ללא Supabase.
- `controlPlaneObservationSource()`: אם `ATLAS_CONTROL_PLANE_URL`/`ATLAS_CONTROL_PLANE_TOKEN` חסרים — `listApplications/Processes/Decisions` מחזירות `[]`. אין crash.
- `listApprovalRequests().catch(() => [])` — שגיאה בapprovals לא מפילה observation.

**8. Audit/evidence לפעולה:**
✅ `appendUnifiedAuditEntry` נקרא על כל פעולה: `psa.created`, `psa.lifecycle`, `psa.recommend`, `psa.escalate`, `psa.coordinate`, `psa.request`
✅ `requestGovernedAction` כותב `psa.request` audit לפני submitAgentProposal, עם `correlationId` ו-`causationId`

**9. Test coverage:**

| קובץ | תוצאה | command |
|------|--------|---------|
| `apps/api/src/routes/personal-supervising-agent.test.ts` | **4/4 PASS** | `npx vitest run apps/api/src/routes/personal-supervising-agent.test.ts` |
| `apps/api/src/services/personal-supervising-agent.test.ts` | **29/29 PASS** | `npx vitest run apps/api/src/services/personal-supervising-agent.test.ts` |
| `apps/web/lib/psa-governed-request.test.ts` | **2/2 PASS** | `npx vitest run apps/web/lib/psa-governed-request.test.ts` |

**סה"כ: 35/35 PSA automated tests PASS**

**10. Runtime evidence ריפו:**
- אין runtime evidence קיימת בריפו (ללא screenshots, network logs, E2E tests עם browser)
- E2E tests: `e2e/new-surfaces.spec.ts` — protected, לא נבדק ב-session זה

---

#### IMPLEMENTATION RESULT

**לא בוצע שום implementation.** Diagnose הוכיח שהחיבור קיים ברמת קוד — לא נמצא product gap שדורש תיקון.

#### RUNTIME VERIFICATION

```
SERVER: NOT STARTED
BROWSER: NOT AVAILABLE
NETWORK EVIDENCE: NOT AVAILABLE
```

**חסמי סביבה זהים ל-ARL-WS-001:**

| משאב | מצב |
|------|------|
| `.env` / `apps/api/.env` / `apps/web/.env` | MISSING |
| `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `COOKIE_SECRET` | MISSING |
| supabase CLI | NOT INSTALLED |
| Docker daemon | NOT RUNNING |

**הערה:** PSA service עצמו כולל fallback ל-`osStore` כשSUPABASE חסר, ולכן PSA תיאורטית יכול לפעול ב-fallback mode — אך הAPI server עצמו לא עולה ללא `DATABASE_URL` (validateEnv מסרב).

#### SECURITY/GOVERNANCE IMPACT

- PSA לא יכול לאשר patches (assertCanAct אוכף status, ו-submitAgentProposal עובר דרך governance)
- PSA לא מתחזה ל-Fabric specialist (`isFabricSpecialistId` check ב-requestGovernedAction)
- `psa:<id>` נדחה כ-specialistId בUI (`FABRIC.has(input.specialistId) || input.specialistId.startsWith("psa:")` → throw)
- scope isolation: ownerId, projectIds, applicationIds — checked ב-assertProjectInScope
- לא בוצע שינוי קוד — אין security impact

#### FILES MODIFIED
אין. שום קובץ לא שונה ב-§2.1.

#### FILES NOT TOUCHED (PROTECTED)
- `apps/api/src/services/governed-command.ts` ✅
- `packages/agent-core/src/orchestrator/dispatch.ts` ✅
- `e2e/new-surfaces.spec.ts` ✅
- `cookies.txt` ✅

#### FINAL CLASSIFICATION

```
STATUS: EXISTING_CONNECTED — RUNTIME BLOCKED (ENVIRONMENT)

Implementation complete (pre-existing).
Automated verification complete: 35/35 PASS.
Runtime/browser verification externally blocked by missing environment.
No further code work required for §2.1 PSA.
```

#### RUNTIME VERIFICATION — ROUND 5 (2026-09-27) — RE-VERIFICATION

בוצע ניסיון re-verification לאחר הכנת DB על ידי ארלט.

**exact server error:**
```json
{"level":"error","message":"CONFIG_ERROR: Invalid server environment: DATABASE_URL: Required; SUPABASE_URL: Required; SUPABASE_ANON_KEY: Required; SUPABASE_SERVICE_ROLE_KEY: Required; ENCRYPTION_KEY: Required; COOKIE_SECRET: Required","service":"atlas-api"}
```

Server לא עלה → PSA API לא נגיש → SupervisingAgentPanel לא יכול לטעון.

```
STATUS: EXISTING_CONNECTED — RUNTIME BLOCKED (ENVIRONMENT)
REASON: CONFIG_ERROR — 6 required env vars missing in this container.
BROWSER VERIFICATION: NOT POSSIBLE
```

**Runtime Reconciliation — ROUND 6 (2026-09-27) — §2.1 PSA:**

```
OFFICIAL RUNTIME IDENTIFIED: local machine + Docker + supabase start (dev); Ubuntu VM + /etc/atlas/*.env (production)
THIS CONTAINER: NOT the intended runtime
CREDENTIAL INJECTION: BLOCKED
DB EXISTENCE: VERIFIED (external screenshot — cfdqhsvriyxhsmhvnzgx.supabase.co, Healthy)
CLASSIFICATION: RUNTIME CONFIGURATION SOURCE IDENTIFIED — CREDENTIAL INJECTION BLOCKED
NO CODE CHANGES — NO IMPLEMENTATION — STOP
```

### 2.2 Language Services — לא מחוברים ל-UI
**סיווג:** `EXISTING_CONNECTED` (source-level; runtime/browser verification outstanding)  
**ראיות:** `apps/api/src/routes/studio-language.ts` + `apps/web/components/studio/StudioLanguageBar.tsx` — connected to hover, definition, references, rename routes. Runtime/browser verification outstanding.  
**קיים ב:** `studio-language.ts`  
**יכולות API:** hover, go-to-definition, references, document symbols, workspace symbols, rename symbol  
**מצב UI:** 🟡 קוד קיים בשני הצדדים — runtime unverified  
**FD §פונקציות שקיימות:** "CONNECT לחיפוש סמלים"  
**הבהרה:** שינוי שם **קובץ** (§FD 9) שונה משינוי שם **סמל** ב-TypeScript. Language rename = שירות שפה בלבד.

### 2.3 Diagnostics Stream → ProblemsPanel — מחובר (תיקון סיווג)
**סיווג:** `EXISTING_CONNECTED — RUNTIME UNVERIFIED`  
**תאריך תיקון:** 2026-09-27 (reconciliation pass)  

**ראיות:**
- `apps/web/app/[locale]/studio/page.tsx` שורה 53: `import { StudioProblemsPanel } from "@/components/studio/StudioProblemsPanel"`
- `apps/web/app/[locale]/studio/page.tsx` שורה 1354: `<StudioProblemsPanel` — מחובר ומרונדר
- `apps/web/components/studio/StudioProblemsPanel.tsx`: קורא ל-`POST /api/v1/projects/${projectId}/studio/language/diagnostics` — מחובר ל-language diagnostics API
- הקומפוננט מאחד: `problemsFromBuildRun(tests.data?.result)` + `problemsFromLanguageDiagnostics(language.data?.diagnostics)`

**תיקון:** הסיווג הישן "wiring MISSING" היה שגוי — החיבור קיים בקוד המקור.  
**מה עדיין חסר:** אימות runtime (server לא עלה בסביבה זו).  
**FD §MOVE:** "לרכז סביב הקובץ הפתוח את מה שכבר קיים: Problems" — ✅ מיושם ברמת קוד.

### 2.4 Studio Second-Identity decide-and-execute — מחובר (תיקון סיווג)
**סיווג:** `EXISTING_CONNECTED — RUNTIME UNVERIFIED`  
**תאריך תיקון:** 2026-09-27 (reconciliation pass)  

**ראיות:**
- `apps/web/components/studio/StudioRunPanel.tsx` שורה 140: `apiPost(\`${path}/decide-and-execute\`, {...})` — StudioRunPanel מחובר
- `apps/web/components/studio/StudioGitStatus.tsx` שורה 106: `apiPost(\`${path}/decide-and-execute\`, {...})` — StudioGitStatus מחובר
- `apps/web/app/[locale]/studio/page.tsx` שורה 1736: `<StudioRunPanel projectId={projectId} />` — מרונדר
- `apps/web/app/[locale]/studio/page.tsx` שורה 1371: `<StudioGitStatus ...>` — מרונדר

**תיקון:** הסיווג הישן "ממתין לפאנל" היה שגוי — שני הפאנלים כבר מחוברים למסלול decide-and-execute.  
**FD §4:** "להציג את הצעד במסלול הקיים. לא מנוע אישור חדש." — ✅ מיושם ברמת קוד.  

### 2.5 Desk Verify — שני נתיבים לא מאוחדים
**קיים ב:** `POST /api/v1/code/patches/:id/verify` (Studio), `POST /api/v1/remediation/drafts/:id/verify` (Desk)  
**מצב:** 🟡 שני נתיבים עצמאיים — IMPLEMENTED_UNVERIFIED  
**FD §5:** "אין ליצור verify שלישי. הדסק צריך להציג את אותו תיקון על נתיב ה-patch המוכח."  
**מה נדרש:** אין לאחד בשלב הזה ללא מיפוי קודם של האובייקטים (Decision C).

### 2.6 git.blame / git.log — תיקון סיווג (reconciliation 2026-09-27)
**סיווג:** `PARTIAL — git.log EXISTING_CONNECTED; git.blame TYPE_ONLY (no UI button)`  
**תאריך תיקון:** 2026-09-27

**ראיות:**
- `apps/api/src/services/governed-command.ts` שורה 62: `id: "git.log"` — בקטלוג, `mutatesWorkspace: false`
- `apps/api/src/services/governed-command.ts` שורה 71: `id: "git.blame"` — בקטלוג, `mutatesWorkspace: false`, `pathArg: "required"`
- `apps/web/components/studio/StudioGitStatus.tsx` שורה 181: `onClick={() => requestCommand.mutate("git.log")}` — **כפתור git.log קיים**
- `apps/web/components/studio/StudioGitStatus.tsx` שורה 21: `| "git.blame"` — מופיע בtype union בלבד, **אין כפתור UI**

**תיקון מסיווג ישן:** הסיווג "UI לא קיים לחלוטין" היה שגוי. git.log מחובר ל-UI דרך StudioGitStatus.  
**מה עדיין חסר:** git.blame — קיים בקטלוג ובtype אבל אין כפתור/trigger ב-UI.  
**FD §פונקציות שקיימות:** "PRESERVE. אין commit. זה מכוון" — ✅ מיושם (git.log מחובר).  
**מה נדרש עבור git.blame:** future planning target בלבד, subject to explicit authorization.

### 2.7 Memory Archive/Consolidate/Storage Meter — תיקון סיווג (reconciliation 2026-09-27)
**סיווג:** `EXISTING_CONNECTED — RUNTIME UNVERIFIED`  
**תאריך תיקון:** 2026-09-27

**ראיות:**

| יכולת | API Route | UI Component | שורה |
|---|---|---|---|
| Archive memory | `POST /api/v1/memory/:id/archive` | `MemoryPanel.tsx` | 299: `mutationFn: (item) => apiPost(\`/api/v1/memory/${item.id}/archive\`, {})` |
| Consolidate/supersede | `POST /api/v1/memory/consolidate` | `MemoryPanel.tsx` | 306–310: `consolidate.mutate(m)` → `/api/v1/memory/consolidate` |
| Storage meter | `GET /api/v1/memory/storage` | `settings/page.tsx` | 72: query to `/api/v1/memory/storage` + שורה 200: `storageUsed` |
| supersededBy | `packages/shared schemas` | `MemoryPanel.tsx` | 41: `supersededBy?: string | null` בtypes |

**API coverage:**
- `apps/api/src/routes/memory.ts` שורה 450: `GET /api/v1/memory/storage` — קיים
- `apps/api/src/routes/memory.ts` שורה 549: `POST /api/v1/memory/:id/archive` — קיים
- `apps/api/src/routes/memory.test.ts` שורות 905–959: archive + storage tests — קיים

**תיקון:** הסיווג הישן "חלקי — חסרים archive, supersededBy, מד אחסון" היה שגוי. כל שלושת הפיצ'רים קיימים ומחוברים ב-source.  
**מה עדיין חסר:** אימות runtime. unification (מיזוג ממצאים דומים אוטומטי) עדיין לא קיים (ראה §7.1).  
**FD §7:** Archive, consolidate, storage meter — ✅ מיושמים ברמת קוד.

---

## 3. יכולות UI חסרות לחלוטין

### 3.1 File Tabs (פתיחות מקבילה של קבצים)
**מצב:** 🔴 MISSING  
**מקור FD:** "השיפורים הוויזואליים שבצילום" — חדר אחד  
**מה חסר:** אין tabs של קבצים פתוחים, ניווט בין קבצים בלי לסגור את הנוכחי, context שנשמר בין קבצים

### 3.2 Persistent File Tree (עץ קבצים תמידי)
**מצב:** 🟡 עץ קיים — אבל disappears בהקשרים מסוימים  
**FD §MOVE:** "לרכז סביב הקובץ הפתוח... עץ"  

### 3.3 Search Panel (חיפוש בפרויקט) — תיקון סיווג (reconciliation 2026-09-27)
**סיווג:** `EXISTING_CONNECTED — RUNTIME UNVERIFIED`  
**תאריך תיקון:** 2026-09-27

**ראיות:**
- `apps/web/app/[locale]/studio/page.tsx` שורה 327: `const [fileSearch, setFileSearch] = useState("")`
- שורה 947: `value={fileSearch}` + שורה 948: `onChange={(e) => setFileSearch(e.target.value)}` — input field קיים
- שורה 477: `queryKey: ["studio-search", ...]` + שורה 485: query to `/api/v1/studio/search` — API call קיים
- שורה 962–994: תוצאות חיפוש מרונדרות (truncated banner, items list, loading, empty state)
- `enabled: Boolean(projectId) && hasRoot && trimmedSearch.length >= 2` — מינימום 2 תווים

**תיקון:** הסיווג "MISSING כ-UI" היה שגוי — search input, query ותצוגת תוצאות קיימים ב-page.tsx.  
**API:** `GET /api/v1/studio/search` — EXISTING_CONNECTED.  
**מה עדיין חסר:** אימות runtime, UI panel עצמאי (כרגע משולב בתוך page.tsx כ-inline search).

### 3.4 Command Palette
**מצב:** 🔴 MISSING  
**FD §D9 approved direction:** "Global: search, command palette, notifications"  
**WSP:** לא מוזכר כנוכחי  

### 3.5 Status Bar
**מצב:** 🟡 UNVERIFIED — לא הוכח שקיים, לא הוכח שחסר  
**ראיות:** אין קומפוננט `StudioStatusBar` (או דומה) ב-`apps/web/components/studio/`. לא בוצעה חיפוש מקיפה מעבר לזה — לא ניתן לסווג MISSING בוודאות.  
**FD §צילום:** "הסרגל העליון נשאר קומפקטי" — אין אזכור לסרגל תחתון.  
**מה נדרש:** inspect מלא של page.tsx ו-layout components לפני סיווג סופי.

### 3.6 Split Editor
**מצב:** 🔴 MISSING — לא מוזכר בשום מסמך קיים

### 3.7 vitest.run — תוצאות מובנות ב-UI
**קיים ב:** governed catalog — `vitest.run` קיים  
**מה חסר ב-UI:** 🔴 אין עץ pass/fail, אין jump-to-failure, אין rerun מה-UI  
**FD §MOVE:** "Run" ברשימת מה שצריך להיות בחדר — קיים כפקודה, לא כתצוגה

### 3.8 StudioPatchDiff — Diff Viewer עצמאי
**מצב:** 🟡 Diff viewer קיים אבל scope'd לזרימת patch בלבד  
**מה חסר:** לא ניתן לפתוח diff בנפרד מחוץ לזרימת patch

### 3.9 StudioGitStatus — staged/unstaged counts
**סיווג:** `EXISTING_CONNECTED` (source-level; runtime verification outstanding)  
**ראיות:** `apps/web/components/studio/StudioGitStatus.tsx` — parses governed git status result, renders changes array. Runtime verification outstanding.  
**מצב:** 🟡 קוד קיים — אומת מקור, לא אומת runtime  
**Q11-2:** ANSWERED (source-level) — הקומפוננט מפרסר changes array ומציג staged/unstaged. אימות runtime עדיין נדרש.

---

## 4. החלטות אדם ממתינות — ארלט חייב לאשר

### 4.1 D2 — ספים ל-UNDERSTAND
**עודכן 2026-09-28:** D2-1/D2-2/D2-3 אושרו ויושמו (Option Y). ראה §1.3 לפרטים מלאים.  
**ספים מספריים** (מה מחשיב VERIFIED / OBSERVED / UNVERIFIED / INSUFFICIENT_EVIDENCE) — פריט פתוח נפרד, לא חלק מחוזה D2 שאושר. ממתין לראיות runtime.

### 4.2 D3 — מדיניות פעולות קובץ
**נדרש:** אילו מהפעולות האלה נכנסות ל-scope:
- יצירת קובץ (`create file`)
- יצירת תיקייה (`create folder`)  
- שינוי שם (`rename`)
- העברה (`move`)
- מחיקת קובץ (`delete file`)
- מחיקת תיקייה ריקה (`delete empty folder`)
- הגנה מ-silent overwrite: version check / hash check / version header

**מה כבר אושר (D3 2026-09-26):** אין overwrite שקט; create לא מחליף; agents לא כותבים ישירות; סט מאושר כולל create file/folder, rename/move, delete file, delete empty folder (ללא recursive delete).  
**מה עדיין פתוח:** D3 overwrite protection — **IMPLEMENTED 2026-09-27** (ראה §4.2 D3 IMPLEMENTATION).

### 4.2.1 D3 IMPLEMENTATION — Silent Overwrite Protection (2026-09-27)
**סטטוס:** ✅ IMPLEMENTED — UNIT TESTED (39/39 PASS)

**מה בוצע:**
- `packages/code-intelligence/src/workspace-browser.ts`: הוסף `hashFileContent()` (SHA-256), `contentHash` ל-`WorkspaceFileView`, ו-`expectedHash` ל-`writeWorkspaceFile` — enforce D3: PUT על קובץ קיים ללא `expectedHash` → throw `OVERWRITE_HASH_REQUIRED`; hash לא תואם → throw `OVERWRITE_CONFLICT`.
- `packages/shared/src/schemas/exemplar.schema.ts`: הוסף `expectedHash: z.string().min(1).max(128).optional()` ל-`studioWriteFileBodySchema`.
- `apps/api/src/routes/code.ts`: `persistStudioWrite` מעביר `body.expectedHash` ל-`writeWorkspaceFile`; catch block מזהה `OVERWRITE_HASH_REQUIRED` / `OVERWRITE_CONFLICT` → 409 (לא 400).
- `apps/api/src/routes/studio-write.test.ts`: הוסף 5 טסטים D3 + עדכן טסט atlas-self עם `expectedHash`.

**ראיות:**
| בדיקה | תוצאה |
|---|---|
| PUT existing file ללא expectedHash | 409 ✅ |
| PUT existing file עם hash שגוי | 409 ✅ |
| PUT existing file עם hash נכון | 200 ✅ |
| PUT קובץ חדש ללא expectedHash | 200 ✅ |
| GET /api/v1/studio/file מחזיר contentHash | ✅ |
| כל 39 טסטים קיימים | PASS ✅ |

**Root cause שנחשף בדיבוג:** `@atlas/shared` dist לא הכיל `expectedHash` עד build — ה-Zod parse strip אותו בשקט. נפתר ב-`pnpm --filter @atlas/shared build` + `pnpm --filter @atlas/code-intelligence build`.

### 4.2.2 D3 WORKSPACE-REPLACE FIX (2026-09-28)
**סטטוס:** ✅ IMPLEMENTED — committed `26c6bf7` (pushed to GitHub)

**בעיה שאובחנה:**
`applyWorkspaceReplace` (packages/code-intelligence/src/workspace-replace.ts:183) קראה ל-`writeWorkspaceFile(workspaceRoot, path, next)` ללא `expectedHash`. כיוון ש-`writeWorkspaceFile` מחייב `expectedHash` לקבצים קיימים (D3 guard), כל replace על קובץ קיים זרק `OVERWRITE_HASH_REQUIRED`.

**תיקון:**
- שורה 183: שונה ל-`writeWorkspaceFile(workspaceRoot, path, next, view.contentHash)`
- `view` מגיע מ-`readWorkspaceFile()` שכבר מחשב `contentHash` (SHA-256)
- D3 overwrite protection עכשיו חל גם על workspace replace

**ראיות:**
| בדיקה | תוצאה |
|---|---|
| workspace-replace.test.ts 2/2 | PASS ✅ |
| studio-language.test.ts (replace route) | PASS ✅ |
| CI על 593f0dd (לפני fix) | FAIL — OVERWRITE_HASH_REQUIRED |
| CI על 26c6bf7 (אחרי fix) | ממתין |

### 4.2.3 STAGE 5 D2 TEST FIXTURES (2026-09-28)
**סטטוס:** ✅ IMPLEMENTED — committed `26c6bf7`

**בעיה שאובחנה:**
Guardian (Stage 5 D2-2 gate) דורש `supporting.length > 0` (לפחות fact אחד עם `overlapCount >= 1`) כדי להחזיר CONSISTENT. ללא apps/ facts — verdict=UNKNOWN → UNVERIFIED → BLOCKED → patch=null.

**tokenizer issue:** regex `/[^a-z0-9./@_-]+/` שומר מקף `-`. לכן `"test-app"` → token `"test-app"`, לא `"test"`. דרוש app name ללא מקפים.

**שלוש fixture corrections:**

| קובץ | Fixture שנוסף | Keyword | Haystack match |
|------|--------------|---------|----------------|
| `apps/api/src/routes/code.test.ts` | `apps/test/index.ts` | `"test"` | `"update test.txt with a safe comment"` ✅ |
| `apps/api/src/routes/studio-remediation-truth.test.ts` | `apps/aws/index.ts` | `"aws"` | `"Remove the hard-coded AWS access key assignment."` ✅ |
| `e2e/stage9/projects.ts` | `apps/hello/index.ts` | `"hello"` | `"hello.ts: change the greeting export comment"` ✅ |

**ראיות unit:**
| בדיקה | תוצאה |
|---|---|
| code.test.ts 35/35 | PASS ✅ |
| studio-remediation-truth.test.ts 6/6 | PASS ✅ |
| workspace-replace.test.ts 2/2 | PASS ✅ |
| studio-language.test.ts 3/3 | PASS ✅ |
| סה"כ 46/46 | PASS ✅ |

**E2E (apps/hello fixture):** UNVERIFIED — ממתין ל-CI על `26c6bf7`.

### 4.3 D4 — מדיניות Patch Rejection (מה שנשאר)
**מה אושר ב-Stage 5:** reason mandatory, actor+timestamp+audit, REJECTED is terminal, correction = new patch עם `supersedesPatchId`.  
**מה עדיין חסר:** אימות runtime של הזרימה, UI ל-rejected patches history.

### 4.4 D5 — Commit/Push Policy (לנעול)
**נדרש:** אישור רשמי שהיעדרם הוא `INTENTIONALLY_NOT_SUPPORTED` **או** החלטה לכלול בשלב עתידי.  
**סטטוס נוכחי:** "FD אומר intentional" — אבל FD הוא כיוון בלבד. זה לא נעול.

### 4.5 D6 — Dashboard Project Selection / URL Sync
**סיווג:** `CONFLICTED / NEEDS EVIDENCE`  
**הערה:** Source contains URL synchronization logic but runtime behavior not conclusively established. Do not claim fixed or broken. Requires runtime evidence.  
**מה אושר:** `?project=<id>` קנוני, selection מעדכן URL, refresh/back coherent, invalid ids → generic state.  
**מה עדיין contradicted:** Dashboard selection **לא מעדכן URL** (`use-project-query.ts`) — זה CONTRADICTION לאישור.  
**נדרש:** ראיות runtime. אין לסגור כ-fixed ואין לסגור כ-broken ללא ראיות runtime מוצקות.

### 4.6 D10 — ADR: Atlas/Core ↔ Studio Boundary Mapping
**מה קיים:** ADR-024 (identity model), ADR-025 (ArletOS ↔ Control boundary) — כתובים.  
**מה חסר:** "Code-level mapping of the Control services ArletOS consumes" (§10, §7.9) — אין מיפוי של שירותים ספציפיים ב-ADR-025 §3.

### 4.7 Q11-4 — Monaco vs Textarea
**שאלה פתוחה:** האם לשדרג מ-textarea-with-highlighting ל-Monaco Editor?  
**השפעה:** TypeScript hover, go-to-definition, references, rename תלויים בזה.  
**מקור:** FD §"העורך נשאר ומשתפר במקומו. הוא textarea עם הדגשה, לא מוצר עורך חדש."  
**דרוש אישור:** לפני ביצוע שום שינוי ב-Editor.

### 4.8 Q11-6 — Extension System or Closed Workbench
**הוחלט (2026-10-03, ארלט) — ADR-026:** מערכת הרחבות מקורית של ArletOS. הרחבות מובנות (Git, בדיקות) והרחבות רשמיות בלבד; התקנה והרשאות ברמת המשתמשת, הפעלה וסדר אייקונים ברמת הפרויקט; אין קוד צד שלישי ואין הרצת קוד הרחבה בשרת. יכולות חדשות (MCP, שאילתות DB, דיבאג, לוגים חיים) דורשות אישור נפרד.  
**שאלה (נסגרה):** האם Studio יתמוך ב-plugin/extension system, או שהוא workbench סגור?  
**מקור:** FD §"מה לא בונים מחדש" — לא מוזכר extension system  
**מה נדרש:** החלטה לפני שמבנים יכולות "pluggable".

---

## 5. חסמי סביבה

### 5.1 Production Verification — BLOCKED
**מקור:** §12, FD §10  
**החסם:** `SUPABASE_SERVICE_ROLE_KEY=replace-me`  
**מה חסום:** Authenticated Studio, Ask Agent, Apply, workspace ב-Production  
**מה לא חסום:** מוצר מקומי תקין; החסם הוא אינפרה

### 5.2 PSA Control Telemetry — BLOCKED
**מקור:** §12, FD §10  
**החסם:** אין Control Plane URL + token  
**מה חסום:** תצפית PSA על תהליכי Control ב-Production  

### 5.3 CI — Apply/SoD/AVR — UNVERIFIED
**מקור:** §12  
**מצב:** `ab07d6b` עם disposable Supabase בCI — **לא נבדק runtime**. אין CI result observed.  
**לא חסום** — לא נצפה.

### 5.4 Stage 9 CI Re-Run — לא בוצע
**מקור:** Stage 7 closure §7.13  
**מה חסר:** CI לא הורץ מחדש אחרי Stage 7 (a11y). `e2e/a11y.spec.ts` — 1 fixme נשאר (hamburger unauthenticated).

---

## 6. שלבי §3 שלא התחילו

| שלב | סטטוס |
|---|---|
| EAG-SEC-01 — Security / Reliability External Workstream | 🔴 NOT STARTED |
| Stage 10 — Production Proof | 🔴 NOT STARTED (environment blocked) |

**הערה:** EAG-SEC-01 הוא workstream נפרד מסגירת ה-governance ההיסטורית של Stage 8 (§Q-R/§Q-S/§Q-T ברגיסטר הראשי). אין לבלבל ביניהם. This is a separate workstream from the historical Stage 8 governance closure (§Q-R/§Q-S/§Q-T in the Master Register). Not to be confused with Stage 8.

**EAG-SEC-01 מכיל:**
- Read-tool secret exposure (`gateway/fulfill` — H finding §7.7) — לא ניתן לסגור סטטית
- Kernel lessons store governance (`kernel/run` project ownership — §7.7)
- `gateway/fulfill` project ownership gate (§7.7)
- Tenant `admin` גישה ל-memory של users אחרים ב-human surfaces (§7.7)

---

## 7. פערים מ-FD §7-10 (כיוון עתידי לא ממומש)

### 7.1 §7 — מחזור חיי זיכרון — MISSING
**מה חסר לחלוטין:**
- 🔴 **איחוד** — אין מנגנון לאיחוד זיכרונות כפולים
- 🔴 **ארכיון** — לא קיים (ARCHIVE status? route? — לא מוזכר בקוד)
- 🔴 **`supersededBy` כלי משתמש** — `commitMemory` לא בודק כפילות; `supersededBy` אינו exposed ב-UI
- 🔴 **מד אחסון** — `GET /memory/storage` קיים ב-API (`383ecb6`), Settings מציג — אבל IMPLEMENTED_UNVERIFIED
- ⚠️ **הבהרה:** `memoryWarningMb` ב-`performance-limits.ts` הוא סף RAM של תהליך שרת — לא מד אחסון משתמש. אסור למחוק זיכרון בעלים אוטומטית.

### 7.2 §8 — כשל חוזר — MISSING
**מה קיים:** `recurring-failure.ts` קורא זיכרון, מקבץ לפי signature, מחזיר INFERRED recommendation.  
**מה חסר:**
- 🔴 **מנוע השוואת אירועים** — אין השוואה בין אירועים מאומתים
- 🔴 **צימוד ראיות** — אין evidence matching
- 🔴 **INFERRED → VERIFIED** — אין מנגנון לאמת המלצה
- 🔴 **כתיבה מתמשכת** — recurring-failure.ts לא כותב כלום

**אזהרה:** אסור לכנות את ה-retrieve הנוכחי "מנוע כשל חוזר". הוא לא.

### 7.3 §9 — פעולות קובץ בדיסק — תיקון סיווג (reconciliation 2026-09-27)
**סיווג:** `EXISTING_CONNECTED — RUNTIME UNVERIFIED`  
**תאריך תיקון:** 2026-09-27

**ראיות:**
- `packages/code-intelligence/src/workspace-browser.ts` שורה 516: `export function moveWorkspaceFile(...)` — קיים בsource
- `apps/api/src/routes/code.ts`: `POST /api/v1/studio/file/move` — route קיים (Stage 4)
- ARL-WS-002 הוסיף: `createWorkspaceFolder`, `deleteWorkspaceFile`, `deleteWorkspaceFolder` — כולם ב-workspace-browser.ts

**תיקון:** הסיווג "MISSING" היה שגוי — `moveWorkspaceFile` קיים ב-source וה-route רשום. לא אומת runtime (server לא עלה בסביבה זו).  
**מה עדיין חסר:** אימות runtime של move/rename.  
**הבהרה:** שינוי שם סמל ב-`StudioLanguageBar` הוא שירות שפה (TypeScript rename symbol), **לא שינוי שם קובץ**.  
**FD:** "אם יתווסף, רק במסלול המאושר. לא פעולה שקטה של ה-PSA או של הצ׳אט."

### 7.4 §10 — אימות Production — ENVIRONMENT-BLOCKED
**הערה:** זהו cross-reference ל-§5.1 בלבד, לא פריט עצמאי נפרד. ראה §5.1 לעיל לפרטים המלאים. This section is a cross-reference to §5.1, not an independent gap item — counted once in §5.1.

---

## 8. פערי תיעוד

| ID | פער |
|---|---|
| DOC-1 | קריטריוני סגירה per-stage לא מתועדים ב-repository (§3, §5) |
| DOC-2 | Stage 1 — אין evidence detail ב-repository (DOC-GAP) |
| DOC-3 | Stage 2 — אין evidence artifact committed (log/screenshot) (DOC-GAP) |

---

## 9. פריטים שנסגרו (לידיעה — לא פעולה)

| פריט | סגור מתי |
|---|---|
| ARL-WS-006 — Accessibility | Stage 7, 2026-09-27, local |
| ARL-E2E-001 | Stage 9, 2026-09-27, 5/5 targeted |
| ARL-E2E-004 | Stage 9, 2026-09-27, 5/5 targeted |
| G-1..G-13 | Stage 5, 2026-09-26 |
| Stage 4 agent boundaries | Stage 4, 2026-09-26 |
| Stage 5 Golden Loop security | Stage 5, 2026-09-26 |
| Stage 6 Web IA/Navigation | VERIFIED locally — not CLOSED (no commit/push) |
| Stage 7 Accessibility | CLOSED locally, CI not re-run |

---

## 10. סדר עבודה מוצע לשלב הבא

> **שים לב:** זה מוצע בלבד. ביצוע מחייב אישור ארלט.

**Priority 1 — החלטות בלוקרים (אדם):**
1. D5: לנעול commit/push כ-INTENTIONALLY_NOT_SUPPORTED (או לפתוח)
2. D2: לאשר ספים ל-UNDERSTAND (מחייב runtime data)
3. D3: לאשר set מלא של file operations
4. Q11-4: Monaco vs Textarea (מחייב לפני language services)

**Priority 2 — חיבורים (CONNECT, ללא קוד חדש):**
1. PSA → 4 endpoints (explain/recommend/escalate/request) → UI panel
2. DiagnosticsStream → ProblemsPanel
3. Dashboard `?project=` URL sync (D6 contradiction)

**Priority 3 — MISSING מוצר (אפס קוד קיים):**
1. ARL-WS-004: ארכיטקטורת ידע שגיאות
2. Memory lifecycle: unification, archive, supersededBy tool
3. Recurring failure engine (write-capable)
4. File ops on disk (rename/move verified)

**Priority 4 — Stage 8 Security/Reliability:**
- Secret exposure read-tool
- Kernel lessons store
- Gateway/fulfill project gate

---

## נספח: פריטים שנסגרו ב-ARL-WS-001 / D4 (Stage 5) — לא פערים

המסמך הישן רשם ARL-WS-001 כ-"שום קוד לא מציב REJECTED". Stage 5 תיקן זאת:
- Route: `POST /api/v1/code/patches/:id/reject` — ✅ קיים
- Schema: `rejection`, `reason`, `actorId`, `timestamp`, `supersedesPatchId` — ✅
- UI: reject button + reason — ✅ IMPLEMENTED (unverified runtime)

**הפריט הנותר מ-ARL-WS-001 הוא runtime verification + history UI — לא missing implementation.**

---

*מסמך זה ממתין לאישור ארלט. לאחר אישור — ניתן לדון ב-future workstream planning. Stage 12 הוא future planning target בלבד, subject to explicit authorization — אינו שלב עבודה מוגדר כרגע.*
