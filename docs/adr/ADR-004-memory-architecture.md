# ADR-004: Typed memory with provenance and temporality

## Status

ACTIVE

## Decision

Do not use a single undifferentiated `memory` dump. Use typed memories (FACT, DECISION, PREFERENCE, …) with source, confidence, status, evidence, `valid_from` / `valid_until`, and `superseded_by`.

## Reason

Prevents the classic failure mode where the agent remembers something that was once true but is no longer active.
