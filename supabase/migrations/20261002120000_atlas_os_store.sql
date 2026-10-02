-- Durable snapshot of the API's operational store (osStore) for serverless
-- hosts. On Vercel the function filesystem is read-only, so `.atlas/store.json`
-- cannot be written; apps/api/src/store/cloud-store-sync.ts keeps the whole
-- store as one versioned JSON document here instead.
--
-- Additive only. Service-role access only: RLS is enabled with no policies,
-- so anon/authenticated clients can neither read nor write it.

create table if not exists public.atlas_os_store (
  id text primary key check (char_length(id) between 1 and 64),
  version bigint not null check (version >= 1),
  shape jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.atlas_os_store enable row level security;

revoke all on table public.atlas_os_store from anon, authenticated;
