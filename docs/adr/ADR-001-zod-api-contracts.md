# ADR-001: Zod schemas as API contract source of truth

## Status

ACTIVE

## Decision

All request/response contracts live in `packages/shared/schemas` and are imported by web, API, and workers.

## Reason

- Prevent frontend/backend drift
- Centralize validation
- Share contracts across applications

## Alternatives

- Duplicate TypeScript interfaces per app
- OpenAPI-first generation only

## Consequences

No duplicated API contracts. TypeScript `any` is forbidden.
