# ADR-015: Governed native code engineering (WRITE controlled)

## Status

ACCEPTED

## Context

ADR-014 and earlier docs phrased WRITE as **locked / disabled** by default.
That was correct as a safety posture against silent mutation, but incomplete as
a product definition.

Atlas must become an **AI Engineering Operating System**: it understands the
portfolio, knows what is proven vs unproven, can plan and produce patches, run
tests, invoke Expert Council, keep provenance, and require human approval before
consequential changes — while remaining **not** an IDE replacement.

External surfaces (Cursor, Claude Code, VS Code, CI) stay first-class
**execution workers**, optional next to a native Atlas patch path.

## Decision

### 1. Normative WRITE rule

**Wrong:** WRITE disabled.  
**Right:** WRITE is **controlled, auditable, reversible, and approval-gated**.

```
AI proposes
  → AI evaluates
  → Experts review (when required)
  → Human approves
  → Apply patch
  → Tests / verification
  → Rollback if regression
```

Dangerous domains may require **dual approval**:
production DB · auth · payments · security · RLS · infrastructure · secrets.

### 2. Product wording (EN)

> Atlas is not an IDE replacement. It provides native, governed
> software-engineering capabilities — including code generation, modification,
> debugging, refactoring, test generation, and verification — while allowing
> external development environments such as Cursor, Claude Code, and VS Code to
> remain first-class execution surfaces.

### 3. Product wording (HE)

> Atlas אינו מחליף IDE. הוא מספק יכולות native מלאות של הנדסת תוכנה — כתיבת קוד,
> שינוי קוד, debugging, refactoring, יצירת בדיקות ואימות — תוך אפשרות להשתמש ב־
> Cursor, Claude Code ו־VS Code כמשטחי עבודה חיצוניים.

### 4. Patch Artifact (not file rewrite dumps)

```
Patch
├── patchId · projectId · baseCommit · targetBranch
├── filesChanged · diff · reason · evidence
├── risk · tests · evaluation · approvals · rollbackRef
```

Flow: Preview → Review → Approve → Apply → Verify → Rollback.

### 5. Code Intelligence Layer (target package)

```
packages/code-intelligence/
  parser · symbol-index · dependency-graph · call-graph
  type-analysis · impact-analysis · patch-engine
  refactoring · test-generation
```

APIs (target):

```
POST /api/v1/code/analyze | explain | patch | refactor | fix
POST /api/v1/code/tests | impact | review | apply | rollback
```

### 6. Agent modes (UI `/agent`)

| Mode | Intent |
| --- | --- |
| Analyze | Understand code only |
| Plan | Implementation plan |
| Generate | New code (patch) |
| Fix | Defect → patch + regression test |
| Refactor | Structure without behavior change |
| Test | Generate / improve tests |
| Secure | Security findings → gated patches |
| Optimize | Perf bottlenecks → patches |
| Implement | Full change under gate |

### 7. Execution surfaces

```
              Atlas (truth + gate)
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
    Native       Cursor      Claude Code
    Agent        (worker)     (worker)
       │            │            │
       └────────────┼────────────┘
                    ▼
               Git Patch
                    │
              Atlas Verify
```

User may choose: apply inside Atlas · hand off to Claude Code · open patch in Cursor.

### 8. Evidence-driven coding

Patches should be triggered by Evidence / Risk / Recommendations
(e.g. HIGH risk + missing tax regression suite → generate tests → fail → fix →
re-verify → risk HIGH→LOW). Coding without provenance is second-class.

### 9. Relationship to ADR-014

ADR-014 remains the epistemic / governance north star. This ADR **amends** the
WRITE posture: Atlas may generate and apply code **only** through Patch
Artifacts + evaluation + approval. It does **not** grant silent WRITE.

## Non-goals

- Becoming a general ChatGPT / Copilot clone without evidence gates
- Silent apply to production-sensitive paths
- Full-file rewrites without diff / baseCommit / rollbackRef
- Replacing Git as the source of applied truth

## Consequences

- README and agent UI replace “WRITE locked” with “WRITE gated”.
- Runtime today may still block apply until patch engine ships; product copy
  describes the **target** capability honestly (propose now · apply under gate next).
- MVP path: Patch Artifact schema → impact analysis stub → approve/apply to local
  worktree or PR · native apply later.
