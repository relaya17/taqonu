-- =============================================================================
-- DRAFT — multi-tenant organizations schema (Phase 1: additive, org tables only)
--
-- THIS FILE IS A DRAFT FOR HUMAN REVIEW. IT HAS NOT BEEN APPLIED TO ANY
-- DATABASE, LOCAL OR PRODUCTION. DO NOT RUN THIS FILE (no `supabase migration
-- up`, no `psql -f`, no copy/paste into a SQL console) WITHOUT FIRST READING
-- AND GETTING SIGN-OFF ON `docs/multi-tenant-design.md`, WHICH THIS FILE
-- IMPLEMENTS ONLY PHASE 1 OF.
--
-- Naming note: this file is intentionally named `DRAFT_multi_tenant_orgs.sql`
-- instead of the real `YYYYMMDDHHMMSS_description.sql` convention used by
-- every other file in this directory. That is deliberate — it keeps this
-- draft visually and mechanically distinct from an active migration so that
-- any migration runner globbing on the timestamp-prefix pattern will not
-- pick it up. Do not rename this file to a timestamped name until the plan
-- in docs/multi-tenant-design.md has been reviewed and approved, and even
-- then, review the SQL below again at that time — it may need to change
-- once the open questions in that document (§7) are answered.
--
-- Scope of what is actually in this file: ONLY the two new tables described
-- in docs/multi-tenant-design.md §2 (`organizations`, `organization_members`)
-- and their RLS policies, exactly as designed in that document. It does NOT
-- add `org_id` to any existing owner_id-scoped table (projects, memories,
-- decisions, evidence_records, claims, etc.) — that is Phase 2 in the
-- rollout plan (§5 of the design doc) and is intentionally not drafted here,
-- since Phase 2 should be reviewed as its own change once Phase 1 has
-- shipped and stabilized. An illustrative (commented-out, non-executable)
-- sketch of what a Phase 2 change looks like for one table is included at
-- the bottom of this file for reviewer context only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is
  'DRAFT (multi-tenant Phase 1) — not yet referenced by any owner_id-scoped '
  'table. See docs/multi-tenant-design.md.';

comment on column public.organizations.created_by is
  'Audit metadata only ("who created this org") — not an authorization check. '
  'ON DELETE SET NULL: deleting the creating user must not delete the org.';

-- RLS is enabled here but its policies are deferred to the end of this file
-- (after organization_members exists) since every organizations policy below
-- needs to query organization_members — creating the policy before that
-- table exists would fail if this script were actually executed top-to-bottom.
alter table public.organizations enable row level security;

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  joined_at timestamptz not null default now(),
  unique (org_id, user_id)
);

comment on table public.organization_members is
  'DRAFT (multi-tenant Phase 1) — join table between organizations and '
  'auth.users. role is an org-scoped role (owner/admin/member), independent '
  'of the platform-level role in public.profiles.role (user/admin). See '
  'docs/multi-tenant-design.md §2 and §5.';

comment on column public.organization_members.role is
  'Org-scoped role: owner (full control incl. delete org) / admin (manage '
  'members + org settings) / member (participates, no admin rights). '
  'Orthogonal to public.profiles.role.';

-- Supports "which orgs is user X in" lookups, which is the shape every
-- org-membership RLS subquery in this design uses (keyed by user_id first).
-- The (org_id, user_id) unique constraint above does not efficiently serve
-- that access pattern, hence this separate index.
create index if not exists organization_members_user_id_org_id_idx
  on public.organization_members (user_id, org_id);

alter table public.organization_members enable row level security;

-- A user can always see their own membership rows (needed just to know what
-- orgs they're in), plus every membership row of any org they belong to
-- (needed to render a member list).
drop policy if exists "organization_members_select_fellow_member" on public.organization_members;
create policy "organization_members_select_fellow_member"
  on public.organization_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.organization_members m2
      where m2.org_id = organization_members.org_id
        and m2.user_id = auth.uid()
    )
  );

-- Only owners/admins of the org may add members.
drop policy if exists "organization_members_insert_admin" on public.organization_members;
create policy "organization_members_insert_admin"
  on public.organization_members for insert
  with check (
    exists (
      select 1 from public.organization_members m
      where m.org_id = organization_members.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- Only owners/admins may change a member's role; a member cannot self-promote.
drop policy if exists "organization_members_update_admin" on public.organization_members;
create policy "organization_members_update_admin"
  on public.organization_members for update
  using (
    exists (
      select 1 from public.organization_members m
      where m.org_id = organization_members.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.organization_members m
      where m.org_id = organization_members.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- Owners/admins may remove members; any member may remove themselves (leave).
drop policy if exists "organization_members_delete_admin_or_self" on public.organization_members;
create policy "organization_members_delete_admin_or_self"
  on public.organization_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.organization_members m
      where m.org_id = organization_members.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- organizations — RLS policies (deferred to here; see comment above the
-- `alter table public.organizations enable row level security` line, since
-- every policy below queries organization_members, which must already exist)
-- ---------------------------------------------------------------------------

-- Members can see the orgs they belong to. Non-members (including anonymous)
-- see nothing — there is no "public org directory" in this draft.
drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member"
  on public.organizations for select
  using (
    exists (
      select 1 from public.organization_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
    )
  );

-- Any authenticated user may create an org (they become its first member via
-- application-layer logic — service-role insert into organization_members
-- immediately after this insert; not modeled as a trigger here so the
-- creator's initial role is an explicit application decision, not implicit).
drop policy if exists "organizations_insert_authenticated" on public.organizations;
create policy "organizations_insert_authenticated"
  on public.organizations for insert
  to authenticated
  with check (auth.uid() = created_by);

-- Only org owners/admins may rename or otherwise update the org row.
drop policy if exists "organizations_update_admin" on public.organizations;
create policy "organizations_update_admin"
  on public.organizations for update
  using (
    exists (
      select 1 from public.organization_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.organization_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- Only org owners may delete the org outright.
drop policy if exists "organizations_delete_owner" on public.organizations;
create policy "organizations_delete_owner"
  on public.organizations for delete
  using (
    exists (
      select 1 from public.organization_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

-- =============================================================================
-- ILLUSTRATIVE ONLY — Phase 2 sketch, NOT part of this migration, NOT to be
-- run. Included so a reviewer can see the full shape of the design in one
-- place. This block is commented out in its entirety; every line below is a
-- SQL comment and executes as a no-op even if this file were mistakenly
-- applied. See docs/multi-tenant-design.md §3–§5 for the real discussion.
--
-- alter table public.projects
--   add column if not exists org_id uuid references public.organizations (id) on delete set null;
--
-- drop policy if exists "projects_owner_all" on public.projects;
-- create policy "projects_owner_or_org_all"
--   on public.projects for all
--   using (
--     auth.uid() = owner_id
--     or (
--       org_id is not null
--       and exists (
--         select 1 from public.organization_members m
--         where m.org_id = projects.org_id
--           and m.user_id = auth.uid()
--       )
--     )
--   )
--   with check (
--     auth.uid() = owner_id
--     or (
--       org_id is not null
--       and exists (
--         select 1 from public.organization_members m
--         where m.org_id = projects.org_id
--           and m.user_id = auth.uid()
--       )
--     )
--   );
-- =============================================================================
