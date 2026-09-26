# ArletOS Master Problem Register

Authoritative tracking for Web / Studio verification and product gaps. The overall register remains **OPEN** except where an item is explicitly **CLOSED** with evidence.

Related plans: `docs/architecture/WEB_STUDIO_MASTER_PLAN_2026-09-26.md`, `docs/architecture/remaining-work.md` (Atlas closure stages 01–19 are historical; do not merge blindly).

## Stage status (Web / Studio verification)

| Stage | Status | Notes |
| --- | --- | --- |
| Stage 1 / 1A | **CLOSED** | Evidence lock baseline (2026-09-26). |
| Stage 2 | **CLOSED** | Projects → Studio project-entry journey runtime-verified HE/EN local (2026-09-26). Unchanged by hydration closure below. |

---

## ARL-HYDRATION-001 — React hydration warning (AppShell theme / language controls)

| Field | Value |
| --- | --- |
| **ID** | ARL-HYDRATION-001 |
| **Status** | **CLOSED** |
| **Classification** | **VERIFICATION INFRASTRUCTURE ISSUE** |
| **Date closed** | 2026-09-26 |
| **Application fix** | **NONE** |

### Original warning

**OBSERVED** in Cursor verification environment (Stage 2 browser verification). React hydration mismatch; stack at `apps/web/components/layout/AppShell.tsx` (~322, `themeToggle` / `IconButton`).

### Reported mismatch

```text
data-cursor-ref="e2"   (theme IconButton)
data-cursor-ref="e3"   (Languages button)
```

Application-owned attributes in the same diff (`aria-label`, `className`, `title`, MUI classes) were not reported as mismatched.

### Repository ownership

Workspace search for `data-cursor-ref`: **0 matches** → **NOT FOUND IN REPOSITORY** (not application-owned).

### Non-Cursor reproduction (2026-09-26, local `pnpm dev`)

| Browser | Route(s) | Hydration warning | `data-cursor-ref` in DOM |
| --- | --- | --- | --- |
| Google Chrome (system, extensions disabled; not Cursor embedded) | `/he/projects`, `/he/studio`, `/he/welcome` | **NOT REPRODUCED** | **Absent** |
| Microsoft Edge (system, InPrivate, extensions disabled) | `/he/projects` | **NOT REPRODUCED** | **Absent** |

### Application-owned hydration mismatch

**NOT DEMONSTRATED** in non-Cursor Chrome or Edge.

### Theme SSR / client alignment (source trace)

```text
apps/web/app/[locale]/layout.tsx
  COLOR_MODE_COOKIE → parseColorMode → initialMode
        ↓
AppProviders → ColorModeProvider(initialMode)
        ↓
useState(initialMode) on first client render
        ↓
AppShell theme toggle (mode-driven aria-label / icon)
```

**VERIFIED** from source: server and first client render use the same `initialMode`. No theme-driven hydration defect demonstrated.

### Stage 2 impact

**NONE.** Hydration console warning does not invalidate Stage 2 Projects → Studio verification (project id, `workspaceRoot`, tree). Stage 2 remains **CLOSED**.

### Limitation (not an application defect)

```text
Manual human-operated Incognito console verification: UNVERIFIED / OPTIONAL
```

Agent pass used Playwright-driven system Chrome/Edge (non-Cursor MCP) for console and DOM checks. Optional human Incognito spot-check does not reopen this item unless new evidence shows an application-owned mismatch without `data-cursor-ref`.

### Required actions

- No AppShell, theme, SSR, or hydration-suppression change.
- Do not treat Cursor-injected `data-cursor-ref` as a product bug.
- If a future **normal** session reproduces hydration mismatch **without** `data-cursor-ref`, open a **new** register item; do not reopen ARL-HYDRATION-001 without new evidence.
