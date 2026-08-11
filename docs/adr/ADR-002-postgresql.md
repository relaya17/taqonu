# ADR-002: PostgreSQL / Supabase as primary datastore

## Status

ACTIVE

## Decision

Use Supabase PostgreSQL with pgvector for relational state and semantic retrieval in one system.

## Alternatives

- MongoDB
- Separate vector DB + SQL DB

## Reason

Relational integrity, RLS, transactions, structured domain model, hybrid search.
