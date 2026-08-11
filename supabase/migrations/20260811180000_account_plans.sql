-- ADR-011: freemium account plans (external Postgres / Supabase)

create table if not exists public.account_plans (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  tier text not null check (tier in ('free', 'pro')),
  cloud_project_limit int not null check (cloud_project_limit > 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.account_plans enable row level security;

create policy account_plans_select_own
  on public.account_plans for select
  using (auth.uid() = owner_id);

create policy account_plans_update_own
  on public.account_plans for update
  using (auth.uid() = owner_id);

-- Service role bypasses RLS for API upserts.
comment on table public.account_plans is
  'Freemium tier per owner. Free = limited cloud projects; local store unlimited.';
