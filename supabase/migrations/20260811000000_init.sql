-- Atlas Core / ArletOS — Phase 1 foundation schema
-- RLS enabled on all application tables. Service-role bypasses RLS on the server only.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- Profiles / ownership
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale text not null default 'he',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'ARCHIVED', 'PLANNED')),
  tech_stack text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

alter table public.projects enable row level security;

create policy "projects_owner_all"
  on public.projects for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Repositories (GitHub evidence)
-- ---------------------------------------------------------------------------
create table if not exists public.repositories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  github_id bigint,
  full_name text not null,
  default_branch text,
  html_url text,
  private boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.repositories enable row level security;

create policy "repositories_via_project"
  on public.repositories for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = repositories.project_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = repositories.project_id and p.owner_id = auth.uid()
    )
  );

create table if not exists public.repository_branches (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories (id) on delete cascade,
  name text not null,
  sha text,
  protected boolean not null default false,
  unique (repository_id, name)
);

alter table public.repository_branches enable row level security;

-- ---------------------------------------------------------------------------
-- Typed memory with provenance + temporal validity
-- ---------------------------------------------------------------------------
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  type text not null,
  statement text not null,
  reason text[] not null default '{}',
  status text not null default 'ACTIVE',
  confidence numeric(4,3) not null default 0.8 check (confidence >= 0 and confidence <= 1),
  category text not null,
  epistemic_state text not null,
  observation_mode text not null,
  source text not null,
  source_type text not null,
  source_id text,
  superseded_by uuid references public.memories (id),
  valid_from timestamptz,
  valid_until timestamptz,
  observed_at timestamptz,
  scope text not null default 'PROJECT',
  priority text not null default 'MEDIUM',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_embedding_hnsw_idx
  on public.memories
  using hnsw (embedding vector_cosine_ops);

alter table public.memories enable row level security;

create policy "memories_owner_all"
  on public.memories for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create table if not exists public.memory_evidence (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories (id) on delete cascade,
  kind text not null,
  reference text not null,
  excerpt text,
  created_at timestamptz not null default now()
);

alter table public.memory_evidence enable row level security;

-- ---------------------------------------------------------------------------
-- Decisions
-- ---------------------------------------------------------------------------
create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  decision text not null,
  reason text[] not null default '{}',
  alternatives text[] not null default '{}',
  trade_offs text[] not null default '{}',
  evidence text[] not null default '{}',
  status text not null default 'ACTIVE',
  confidence numeric(4,3) not null default 1,
  epistemic_state text not null default 'CONFIRMED',
  superseded_by uuid references public.decisions (id),
  adr_path text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.decisions enable row level security;

create policy "decisions_owner_all"
  on public.decisions for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Tasks / roadmap
-- ---------------------------------------------------------------------------
create table if not exists public.roadmaps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid not null references public.roadmaps (id) on delete cascade,
  title text not null,
  due_at timestamptz,
  status text not null default 'OPEN'
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete set null,
  title text not null,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roadmaps enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;

-- ---------------------------------------------------------------------------
-- Knowledge / verified research
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  organization text not null,
  source_type text not null,
  authority_level text not null,
  jurisdiction text,
  allowed boolean not null default true,
  verification_method text not null,
  update_frequency text,
  last_checked timestamptz,
  trust_policy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources (id) on delete cascade,
  url text not null,
  title text,
  published_at timestamptz,
  updated_at timestamptz,
  retrieved_at timestamptz not null default now(),
  source_version text,
  api_version text,
  expires_at timestamptz
);

create table if not exists public.knowledge_claims (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources (id) on delete cascade,
  document_id uuid references public.knowledge_documents (id) on delete set null,
  statement text not null,
  quote text,
  retrieved_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz,
  source_version text,
  api_version text,
  expires_at timestamptz,
  confidence numeric(4,3) not null default 0.5,
  epistemic_state text not null,
  freshness_score numeric(6,5),
  conflicting_claim_ids uuid[] not null default '{}'
);

alter table public.knowledge_sources enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_claims enable row level security;

-- ---------------------------------------------------------------------------
-- Agent audit
-- ---------------------------------------------------------------------------
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  mode text not null,
  status text not null,
  user_request text not null,
  answer text,
  epistemic_state text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by text not null
);

create table if not exists public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  kind text not null,
  status text not null,
  input_summary text,
  output_summary text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  tool text not null,
  project_id uuid,
  authorization text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result text,
  error_code text
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  kind text not null,
  severity text not null default 'INFO',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.tool_calls enable row level security;
alter table public.audit_logs enable row level security;
alter table public.security_events enable row level security;

create policy "agent_runs_owner_all"
  on public.agent_runs for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Integrations (encrypted credentials live outside LLM context)
-- ---------------------------------------------------------------------------
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  display_name text not null,
  status text not null default 'DISCONNECTED',
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_permissions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.integration_accounts (id) on delete cascade,
  key text not null,
  granted boolean not null default false,
  requires_approval boolean not null default false,
  unique (account_id, key)
);

-- Encrypted credential blobs — never select into LLM prompts
create table if not exists public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.integration_accounts (id) on delete cascade,
  ciphertext bytea not null,
  nonce bytea not null,
  key_version int not null default 1,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.integration_accounts (id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.deployment_projects (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  provider text not null check (provider in ('vercel', 'netlify', 'render')),
  external_project_id text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  deployment_project_id uuid not null references public.deployment_projects (id) on delete cascade,
  external_deployment_id text not null,
  status text not null,
  url text,
  commit_sha text,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deployment_logs (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.deployments (id) on delete cascade,
  excerpt text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  status text not null default 'QUEUED',
  stage text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.integration_accounts enable row level security;
alter table public.integration_permissions enable row level security;
alter table public.integration_tokens enable row level security;
alter table public.deployments enable row level security;

create policy "integration_accounts_owner_all"
  on public.integration_accounts for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Seed official knowledge sources (global allowlist)
insert into public.knowledge_sources (
  domain, organization, source_type, authority_level, allowed, verification_method
) values
  ('docs.github.com', 'GitHub', 'OFFICIAL_DOCUMENTATION', 'TIER_1', true, 'official_docs'),
  ('supabase.com', 'Supabase', 'OFFICIAL_DOCUMENTATION', 'TIER_1', true, 'official_docs'),
  ('platform.openai.com', 'OpenAI', 'OFFICIAL_DOCUMENTATION', 'TIER_1', true, 'official_docs')
on conflict (domain) do nothing;
