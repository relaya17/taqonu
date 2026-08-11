-- Architecture v1.0 — Evidence, Current State, Engineering Graph, Events, Eval
-- Additive on top of Phase 1 init. Does not expand connector product surface.

-- ---------------------------------------------------------------------------
-- Evidence + Claims
-- ---------------------------------------------------------------------------
create table if not exists public.evidence_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  source text not null,
  source_type text not null,
  source_id text,
  uri text,
  excerpt text,
  version text,
  observed_at timestamptz not null default now(),
  confidence numeric(4,3) not null default 1 check (confidence >= 0 and confidence <= 1),
  epistemic_state text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  statement text not null,
  epistemic_state text not null,
  confidence numeric(4,3) not null default 0.5,
  as_of timestamptz not null default now(),
  version text,
  conflicting_claim_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.claim_evidence (
  claim_id uuid not null references public.claims (id) on delete cascade,
  evidence_id uuid not null references public.evidence_records (id) on delete cascade,
  primary key (claim_id, evidence_id)
);

alter table public.evidence_records enable row level security;
alter table public.claims enable row level security;
alter table public.claim_evidence enable row level security;

create policy "evidence_owner_all" on public.evidence_records
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "claims_owner_all" on public.claims
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Current State (system center)
-- ---------------------------------------------------------------------------
create table if not exists public.project_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  as_of timestamptz not null,
  reconciled_at timestamptz not null default now(),
  overall_epistemic_state text not null,
  source_connectors text[] not null default '{github}',
  created_at timestamptz not null default now()
);

create table if not exists public.project_state_slices (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.project_state_snapshots (id) on delete cascade,
  slice_key text not null,
  summary text not null,
  epistemic_state text not null,
  confidence numeric(4,3) not null,
  evidence_ids uuid[] not null default '{}',
  claim_ids uuid[] not null default '{}',
  as_of timestamptz not null,
  valid_until timestamptz,
  stale boolean not null default false,
  unique (snapshot_id, slice_key)
);

create table if not exists public.state_conflicts (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.project_state_snapshots (id) on delete cascade,
  slice_key text not null,
  claim_a_id uuid not null references public.claims (id),
  claim_b_id uuid not null references public.claims (id),
  resolution text,
  epistemic_state text not null default 'CONFLICTED',
  detected_at timestamptz not null default now()
);

alter table public.project_state_snapshots enable row level security;
alter table public.project_state_slices enable row level security;
alter table public.state_conflicts enable row level security;

create policy "state_snapshots_owner_all" on public.project_state_snapshots
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Engineering Graph
-- ---------------------------------------------------------------------------
create table if not exists public.graph_nodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  type text not null,
  key text not null,
  label text not null,
  epistemic_state text not null,
  confidence numeric(4,3) not null default 0.5,
  evidence_ids uuid[] not null default '{}',
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, type, key)
);

create table if not exists public.graph_edges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  type text not null,
  from_node_id uuid not null references public.graph_nodes (id) on delete cascade,
  to_node_id uuid not null references public.graph_nodes (id) on delete cascade,
  epistemic_state text not null,
  confidence numeric(4,3) not null default 0.5,
  evidence_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists graph_edges_from_idx on public.graph_edges (from_node_id);
create index if not exists graph_edges_to_idx on public.graph_edges (to_node_id);

alter table public.graph_nodes enable row level security;
alter table public.graph_edges enable row level security;

create policy "graph_nodes_owner_all" on public.graph_nodes
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "graph_edges_owner_all" on public.graph_edges
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Domain events (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  occurred_at timestamptz not null default now(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  correlation_id uuid not null,
  causation_id uuid,
  epistemic_state text not null,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists domain_events_owner_occurred_idx
  on public.domain_events (owner_id, occurred_at desc);

alter table public.domain_events enable row level security;

create policy "domain_events_owner_select" on public.domain_events
  for select using (auth.uid() = owner_id);

-- inserts via service role / backend only (no direct browser insert policy)

-- ---------------------------------------------------------------------------
-- Evaluation harness (blocks WRITE until gate opens)
-- ---------------------------------------------------------------------------
create table if not exists public.eval_suites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dimensions text[] not null,
  write_unlock_required boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  suite_id uuid not null references public.eval_suites (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null,
  write_gate_open boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.eval_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.eval_runs (id) on delete cascade,
  dimension text not null,
  score numeric(4,3) not null,
  passed boolean not null,
  notes text
);

alter table public.eval_runs enable row level security;
alter table public.eval_results enable row level security;

create policy "eval_runs_owner_all" on public.eval_runs
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

insert into public.eval_suites (name, dimensions, write_unlock_required)
select
  'mvp-write-gate',
  array[
    'ACCURACY',
    'RETRIEVAL',
    'MEMORY',
    'EVIDENCE',
    'SECURITY',
    'AUTHORIZATION',
    'TOOL_SELECTION',
    'REGRESSION'
  ],
  true
where not exists (
  select 1 from public.eval_suites where name = 'mvp-write-gate'
);
