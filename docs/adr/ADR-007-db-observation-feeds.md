# ADR-007: External databases are observation feeds

## Status

ACTIVE

## Decision

Atlas primary store remains Supabase/Postgres (+ local `.atlas/store.json` for durable personal instance when cloud keys are placeholders).

MongoDB and project-owned Supabase instances are **connectors** that emit FACT metadata (tables/collections/RLS flags) into Evidence and the DATABASE state slice.

## Deny

- Connection secrets / passwords in LLM context
- Document body dumps into embeddings by default
- Replacing Atlas memory DB with Mongo
