-- Auth / tenant isolation hardening for projects + evidence (ADR-012).
-- Idempotent: safe to re-apply. Service-role clients (API dual-write) bypass RLS.
-- Anon/authenticated JWT clients are isolated by auth.uid() = owner_id (or via parent).

-- ---------------------------------------------------------------------------
-- Projects (owner_id)
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;

drop policy if exists "projects_owner_all" on public.projects;
create policy "projects_owner_all"
  on public.projects for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Evidence records + claims (owner_id)
-- ---------------------------------------------------------------------------
alter table public.evidence_records enable row level security;
alter table public.claims enable row level security;
alter table public.claim_evidence enable row level security;

drop policy if exists "evidence_owner_all" on public.evidence_records;
create policy "evidence_owner_all"
  on public.evidence_records for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "claims_owner_all" on public.claims;
create policy "claims_owner_all"
  on public.claims for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Junction: tenant via owning claim (was RLS-enabled without a policy)
drop policy if exists "claim_evidence_via_claim" on public.claim_evidence;
create policy "claim_evidence_via_claim"
  on public.claim_evidence for all
  using (
    exists (
      select 1 from public.claims c
      where c.id = claim_evidence.claim_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.claims c
      where c.id = claim_evidence.claim_id and c.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Memory evidence (via memories.owner_id) — RLS was on, policy missing
-- ---------------------------------------------------------------------------
alter table public.memory_evidence enable row level security;

drop policy if exists "memory_evidence_via_memory" on public.memory_evidence;
create policy "memory_evidence_via_memory"
  on public.memory_evidence for all
  using (
    exists (
      select 1 from public.memories m
      where m.id = memory_evidence.memory_id and m.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.memories m
      where m.id = memory_evidence.memory_id and m.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Repository branches (via project ownership)
-- ---------------------------------------------------------------------------
alter table public.repository_branches enable row level security;

drop policy if exists "repository_branches_via_project" on public.repository_branches;
create policy "repository_branches_via_project"
  on public.repository_branches for all
  using (
    exists (
      select 1
      from public.repositories r
      join public.projects p on p.id = r.project_id
      where r.id = repository_branches.repository_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.repositories r
      join public.projects p on p.id = r.project_id
      where r.id = repository_branches.repository_id and p.owner_id = auth.uid()
    )
  );

comment on policy "projects_owner_all" on public.projects is
  'Tenant isolation: JWT auth.uid() must match owner_id. API service-role bypasses RLS.';

comment on policy "evidence_owner_all" on public.evidence_records is
  'Tenant isolation for evidence_records by owner_id.';
