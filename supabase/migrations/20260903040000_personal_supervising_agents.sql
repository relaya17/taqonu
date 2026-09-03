-- Phase 11: persistent Personal Supervising Agent identity.
-- This is NOT a Fabric catalog row and NOT a second identity system.
-- owner_id is the authorized user UUID; agent_id is the stable label psa:<ownerId>.
-- Authorization remains owner + tenant + project + application + lifecycle status.

create table public.personal_supervising_agents (
  owner_id uuid primary key,
  agent_id text not null unique check (agent_id = ('psa:' || owner_id::text)),
  agent_class text not null check (agent_class = 'PERSONAL_SUPERVISING_AGENT'),
  tenant_id text not null check (char_length(tenant_id) between 1 and 128),
  project_ids jsonb not null default '[]'::jsonb,
  application_ids jsonb not null default '[]'::jsonb,
  status text not null check (status in ('ACTIVE', 'PAUSED', 'DISABLED', 'REVOKED', 'DEGRADED')),
  recommendations jsonb not null default '[]'::jsonb,
  escalations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  last_activity_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index personal_supervising_agents_status_idx
  on public.personal_supervising_agents (status);

alter table public.personal_supervising_agents enable row level security;

create policy personal_supervising_agents_select_own
  on public.personal_supervising_agents for select
  using (auth.uid() = owner_id);

create policy personal_supervising_agents_insert_own
  on public.personal_supervising_agents for insert
  with check (auth.uid() = owner_id);

create policy personal_supervising_agents_update_own
  on public.personal_supervising_agents for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create or replace function public.personal_supervising_agent_protect()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'personal supervising agent records cannot be deleted';
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.agent_id is distinct from old.agent_id
     or new.agent_class is distinct from old.agent_class
     or new.created_at is distinct from old.created_at
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'personal supervising agent identity and tenant scope are immutable';
  end if;
  if old.status = 'REVOKED' and new.status is distinct from 'REVOKED' then
    raise exception 'a revoked personal supervising agent cannot be reactivated';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger personal_supervising_agent_protect
  before update or delete on public.personal_supervising_agents
  for each row execute function public.personal_supervising_agent_protect();

comment on table public.personal_supervising_agents is
  'One persistent Personal Supervising Agent per authorized owner. Stable label psa:<ownerId> is not authorization.';
