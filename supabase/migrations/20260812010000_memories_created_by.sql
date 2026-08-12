-- `memories.created_by` was never added in the init migration even though the
-- app-level Memory schema (packages/shared/src/schemas/memory.schema.ts)
-- always carries it. Additive + idempotent — safe to re-apply.
alter table public.memories
  add column if not exists created_by text not null default 'system';

alter table public.memories
  alter column created_by drop default;

comment on column public.memories.created_by is
  'Free-text actor label (user id, "qa-portfolio", "system", ...) — provenance, not a FK.';
