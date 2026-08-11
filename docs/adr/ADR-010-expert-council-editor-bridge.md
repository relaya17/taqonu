# ADR-010: Expert Council + Editor Bridge (not an IDE)

## Status

ACTIVE

## Context

ArletOS needs multi-domain expertise: Engineering, QA, UI/UX, Visual Design,
Accessibility (RTL he/ar), Security, Product, DevOps.

Users also want a place to write code / use a terminal — or integrate with Cursor.

## Decision

### 1. Expert Council (inside ArletOS)

ArletOS hosts **expert lenses**, not separate products:

```
Engineering · QA · UI/UX · Visual Design · Accessibility
· Security · Product · DevOps
```

Each expert contributes:
- system prompt discipline
- checklist / review dimensions
- preferred epistemic labels
- when to escalate to another expert

The agent may activate **one primary + supporting experts** per request.

Visual Design covers layout, typography, brand, export specs for Figma/Photoshop
workflows — ArletOS does **not** embed Photoshop/Figma editors.

### 2. Editor Bridge (Cursor / Claude Code / VS Code) — not a Visual Studio clone

```
ArletOS  = understand + QA + design review + memory
Cursor   = write code + terminal + debugger
```

Integration path:

1. `GET /api/v1/projects/:id/context-export` (existing)
2. `POST /api/v1/editor/brief` — generates a Cursor-ready brief (Markdown)
3. Future MCP resources wrapping the same payloads

**Non-goals:**
- Do not build an in-app IDE with full terminal/debugger like Visual Studio
- Do not compete with Cursor for coding UX
- Optional later: deep-link `cursor://` / copy-brief button only

### 3. WRITE gate unchanged

Code changes proposed by any expert still require APPROVE + write-gate.

## Consequences

- `@atlas/experts` package + shared Zod schemas
- Agent injects expert system blocks into context
- UI: Experts screen + Agent expert selector
- Docs/README state the complementarity model clearly
