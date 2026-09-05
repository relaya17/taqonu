-- P0.1: durable no-approval-path execution receipt (Correction Design Gate,
-- Issue B). Closes the specific gap identified in
-- docs/architecture/ATLAS_MASTER_TRUTH.md section 66: outside the
-- approval-gated path (which already has a fully durable Postgres claim/
-- finalize state machine -- see public.approval_requests /
-- apps/api/src/services/governed-claimed-execution.ts), a governed action's
-- ONLY duplicate-execution protection was the in-process
-- `governedIdempotency` Map in apps/api/src/services/governed-execution.ts,
-- persisted to a JSON file via the same `findRepoRoot()` helper that
-- resolves to `process.cwd()` under `process.env.VERCEL` -- the identical
-- ephemeral-Vercel-filesystem problem the original P0 fix already solved
-- for audit evidence, but here for execution safety instead.
--
-- Design (see ATLAS_MASTER_TRUTH.md section 66 for the full write-up,
-- including the rejected alternative of extending `public.tool_calls`):
--   * A new, narrow, service-role-only table -- NOT an extension of
--     `public.tool_calls`, whose `run_id` is `not null references
--     agent_runs(id)` and whose `agent_runs.owner_id` is in turn `not null
--     references auth.users(id)`. Reusing it would force fabricating a
--     real-user-owned `agent_runs` row for every low-risk, no-approval
--     governed action, reintroducing the exact FK hazard already solved
--     for `audit_logs` via a nullable `owner_id` (see
--     20260811000000_init.sql / 20260905000000_audit_logs_canonical_chain.sql).
--   * `idempotency_key` is the single source of truth for claiming: a plain
--     `insert ... on conflict (idempotency_key) do nothing` claims the row.
--     Deliberately NO trigger is involved in this table (unlike
--     audit_logs' hash chain) -- there is nothing here that needs one, and
--     avoiding one avoids any chance of an Issue-A-class BEFORE/AFTER
--     INSERT + ON CONFLICT bug in this new table.
--   * Finalize is a conditional `update ... where idempotency_key = $1 and
--     status = 'STARTED'`, which is naturally race-safe: Postgres row-level
--     locking on UPDATE means only one of two concurrent finalizers can
--     ever match the `status = 'STARTED'` predicate; the other affects zero
--     rows.
--   * `project_id` is `text`, not `uuid` -- unlike `tool_calls.project_id`
--     (which is an unconstrained `uuid` column). `governedRequest.identity.
--     projectId` is checked for existence against the in-memory/JSON-file
--     `osStore` (see `apps/api/src/services/project-access.ts`'s
--     `assertGovernedProjectExists`), not against `public.projects`, so it
--     is not guaranteed to be a real UUID (synthetic/system project ids are
--     used elsewhere in this codebase, e.g. the audit_logs owner_id note).
--     `text` accepts any value this field will ever actually hold; nothing
--     here joins or filters on it, so there is no correctness cost.
--   * `status` reuses the existing `OUTCOME_UNKNOWN` recovery vocabulary
--     already established by the approval lifecycle
--     (`governed-claimed-execution.ts` / `approvals.ts`) rather than
--     inventing a new one, per the Owner's explicit instruction. This
--     migration does not itself write `OUTCOME_UNKNOWN` -- that value is
--     reserved for a future reconciliation pass over rows stuck in
--     `STARTED` past some operational staleness threshold, which is
--     explicitly out of scope for this pass (see the final report's
--     Remaining/Unresolved section).
--
-- NOT EXECUTED in this session: this environment has no local Postgres,
-- Docker, or Supabase CLI (see the environment-gate findings referenced in
-- ATLAS_MASTER_TRUTH.md section 65). Hand-traced against
-- 20260811000000_init.sql (RLS/service-role conventions) and
-- 20260905000000_audit_logs_canonical_chain.sql (this table's sibling, same
-- nullable owner_id-references-auth.users convention) before being
-- written. Apply with `supabase db push` (or the project's migration
-- runner) and run
-- `supabase/tests/20260905030000_governed_execution_receipts.test.sql`
-- against a real instance before trusting this as verified.

create table if not exists public.governed_execution_receipts (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  owner_id uuid references auth.users (id) on delete set null,
  project_id text,
  entity_type text,
  action text,
  artifact_hash text not null,
  status text not null default 'STARTED',
  outcome jsonb,
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  constraint governed_execution_receipts_status_check
    check (status in ('STARTED', 'EXECUTED', 'FAILED', 'OUTCOME_UNKNOWN'))
);

-- The claim/replay/reclaim protocol described above depends entirely on
-- this being a true uniqueness constraint, not just an index: it is what
-- turns a second, concurrent `insert ... on conflict (idempotency_key) do
-- nothing` into a guaranteed no-op rather than a second row for the same
-- governed action.
create unique index if not exists governed_execution_receipts_idempotency_key_idx
  on public.governed_execution_receipts (idempotency_key);

create index if not exists governed_execution_receipts_status_idx
  on public.governed_execution_receipts (status);

alter table public.governed_execution_receipts enable row level security;

-- Service-role-only, matching the existing tool_calls / agent_steps /
-- security_events convention (20260811000000_init.sql): RLS enabled, zero
-- policies. Unlike audit_logs this table has no owner-scoped SELECT policy
-- at all -- nothing in this pass reads it from the anon/authenticated
-- roles; it exists purely as the API/service layer's durable claim ledger,
-- exactly like tool_calls.
