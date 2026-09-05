-- P0 persistence fix: make public.audit_logs a real, concurrency-safe
-- canonical audit store instead of unused schema.
--
-- Context: apps/api/src/services/audit-log.ts writes the canonical
-- governance/audit trail only to a local NDJSON file
-- (.atlas/audit/audit.ndjson). On Vercel that file lives on an ephemeral,
-- largely read-only filesystem, so the canonical record does not durably
-- survive between invocations. public.audit_logs already existed (see
-- 20260811000000_init.sql) with RLS enabled but zero policies and zero
-- application writers -- this migration is additive only: it adds the
-- columns needed for a write-time-safe hash chain and the one missing
-- read policy, without touching any other table or existing data.
--
-- Design (see docs/architecture/ATLAS_MASTER_TRUTH.md section 65, "P0
-- Persistence Implementation (2026-09-05)", and section 66, "P0 Correction
-- (2026-09-05)", for the full write-up):
--   * seq        -- bigserial ordering column (assigned by Postgres itself)
--   * prev_hash / hash -- a real hash chain, computed inside an AFTER
--     INSERT trigger while holding a lock on a one-row "chain tip" table, so
--     two concurrent Vercel invocations cannot both read the same prev hash
--     the way the file-based writer's read-last-line-then-append pattern
--     could. This mirrors (does not duplicate) the existing NDJSON chain
--     design in apps/api/src/services/audit-log.ts; the two chains are
--     independent and are not required to produce identical hash values,
--     only to each be internally tamper-evident within their own store.
--
--     CORRECTION (2026-09-05, before this migration was ever applied to any
--     real database): the chain mutation was originally written as a
--     BEFORE INSERT trigger. PostgreSQL fires BEFORE INSERT row triggers --
--     and any side effects they perform -- before the ON CONFLICT arbiter
--     decides whether a row is actually kept. For
--     `INSERT ... ON CONFLICT (id) DO NOTHING`, that means a duplicate/
--     idempotent-retry insert (exactly the case `AuditLogRepository.append()`
--     exists to handle safely) would still advance `audit_logs_chain_tip`
--     to a hash that corresponds to no row in the table, corrupting
--     subsequent chain linkage -- the same mechanism that causes
--     serial/bigserial columns to "skip" values on ON CONFLICT DO NOTHING,
--     generalized to a hand-written side effect. Fixed by moving the
--     mutation to an AFTER INSERT trigger: PostgreSQL guarantees AFTER ROW
--     triggers do not fire for rows discarded by ON CONFLICT DO NOTHING --
--     only for rows that are genuinely persisted -- so a duplicate insert
--     now never touches the tip. The row is inserted with prev_hash/hash
--     left NULL and the AFTER trigger immediately UPDATEs that same row
--     (and the tip) inside the same transaction, so by the time the
--     client's insert call returns success, both columns are already
--     populated in the committed row -- but note this means the INSERT
--     statement's own RETURNING projection (evaluated before AFTER
--     triggers run) does NOT reflect prev_hash/hash; a caller must always
--     re-read the row by id to see the chained values (see
--     `AuditLogRepository.append()`, updated to always do so).
--   * an owner-scoped SELECT policy, matching the existing
--     domain_events_owner_select convention (20260811120000_architecture_v1.sql).
--     No INSERT/UPDATE/DELETE policy is added for anon/authenticated roles --
--     writes remain service-role only, exactly like domain_events.
--
-- NOT EXECUTED in this session: this environment has no local Postgres,
-- Docker, or Supabase CLI, so this migration could not be applied against a
-- real database here. It was hand-traced against the exact schema in
-- 20260811000000_init.sql and 20260811120000_architecture_v1.sql (the only
-- two migrations that mention audit_logs/domain_events) before being
-- written, and re-traced against the AFTER INSERT semantics documented in
-- the PostgreSQL trigger reference before this correction. Apply with
-- `supabase db push` (or the project's migration runner) and re-run
-- `supabase/tests/20260905000000_audit_logs_canonical_chain.test.sql`
-- against a real instance before trusting this as verified. This file was
-- never applied to any real database before this correction, so it is
-- edited in place rather than superseded by a second migration -- there is
-- no deployed state to migrate away from.

alter table public.audit_logs
  add column if not exists seq bigserial,
  add column if not exists prev_hash text,
  add column if not exists hash text;

-- seq is assigned by Postgres and must be unique; it is the ordering key
-- verification reads by, not a proof of gap-free history on its own (a
-- rolled-back transaction can legitimately consume a sequence value without
-- ever inserting a row) -- the hash chain, not seq contiguity, is what
-- verification actually trusts.
create unique index if not exists audit_logs_seq_idx on public.audit_logs (seq);

-- Singleton "chain tip" row. Locking this one row (`for update`) inside the
-- trigger is what makes concurrent inserts safe: Postgres serializes any
-- two transactions that try to lock the same row, so the second writer
-- always sees the first writer's committed (or rolled-back) tip_hash, never
-- a stale read from before the first writer's insert.
create table if not exists public.audit_logs_chain_tip (
  id boolean primary key default true,
  tip_hash text not null default 'GENESIS',
  constraint audit_logs_chain_tip_singleton check (id)
);

insert into public.audit_logs_chain_tip (id, tip_hash)
  values (true, 'GENESIS')
  on conflict (id) do nothing;

-- Superseded by audit_logs_chain_after_insert() below -- kept only as a
-- drop target for environments where the original BEFORE INSERT version
-- from this same migration's first cut might already have been applied.
drop trigger if exists audit_logs_chain_trigger on public.audit_logs;
drop function if exists public.audit_logs_chain_before_insert();

create or replace function public.audit_logs_chain_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_tip text;
  computed_hash text;
begin
  select tip_hash into current_tip
    from public.audit_logs_chain_tip
    where id = true
    for update;

  if current_tip is null then
    current_tip := 'GENESIS';
  end if;

  -- Independent of the NDJSON chain's hash function by design (see header
  -- comment) -- this only needs to be internally self-consistent so a later
  -- verification pass, re-running this same computation, can detect a
  -- tampered or deleted row.
  computed_hash := encode(
    digest(current_tip || '|' || coalesce(new.payload::text, '{}'), 'sha256'),
    'hex'
  );

  -- AFTER trigger: the row already exists as committed by the INSERT this
  -- fired for (and only fires for rows that survived ON CONFLICT DO
  -- NOTHING -- see header comment). Update it in place with the chain
  -- values rather than assigning to NEW, which AFTER triggers cannot use
  -- to change the stored row.
  update public.audit_logs
    set prev_hash = current_tip, hash = computed_hash
    where id = new.id;

  update public.audit_logs_chain_tip set tip_hash = computed_hash where id = true;

  return null;
end;
$$;

create trigger audit_logs_chain_trigger
  after insert on public.audit_logs
  for each row
  execute function public.audit_logs_chain_after_insert();

-- Read policy only -- writes stay service-role-only (RLS is bypassed by the
-- service role client already used everywhere else in packages/database).
-- owner_id is legitimately NULL for system/platform-level and synthetic
-- (TEST-*) governed actions that have no single tenant owner; those rows
-- are simply invisible to this owner-scoped policy, which fails closed on
-- visibility rather than exposing them broadly -- a deliberate, documented
-- simplification for this P0 pass, not an oversight (see
-- ATLAS_MASTER_TRUTH.md section 65, "owner_id" note).
drop policy if exists "audit_logs_owner_select" on public.audit_logs;
create policy "audit_logs_owner_select" on public.audit_logs
  for select using (auth.uid() = owner_id);
