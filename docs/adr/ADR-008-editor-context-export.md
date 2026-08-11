# ADR-008: Cursor / Claude context export

## Status

ACTIVE

## Decision

Editors stay external. ArletOS exposes read-only context packs:

`GET /api/v1/projects/:id/context-export`

Markdown includes Current State slices, decisions, memories sample, evidence counts — with epistemic labels. No secrets.

Future: MCP resources wrapping the same payload.
