# Multi-tenant organizations — design doc (DRAFT, for review)

Status: **proposal, not approved, nothing in this document has been applied to any
database.** It exists to give a human reviewer enough context to make a real
decision about schema direction before any migration is executed. The
companion draft SQL file is `supabase/migrations/DRAFT_multi_tenant_orgs.sql`
(note the `DRAFT_` prefix — it is deliberately not a real timestamped
migration and is not picked up by the migration runner).

## 1. Why this is needed

Every table in the current schema (`supabase/migrations/20260811000000_init.sql`
onward) that carries the notion of "who does this row belong to" uses a single
column, `owner_id uuid references auth.users(id)`, and every Row Level
Security policy is the same one-line shape:

```sql
using (auth.uid() = owner_id)
```

That is a strictly single-user ownership model: a row belongs to exactly one
`auth.users` row, full stop. `packages/shared/src/schemas/auth.schema.ts`
confirms there is no org concept anywhere in the type system either —
`userRoleSchema` is `"user" | "admin"`, a *platform* role (whether you can see
the admin console), not a tenant/organization role. The application-layer
authorization helpers that were hardened this session —
`resolveOwnerId` in `apps/api/src/services/plan-quota.ts`,
`getProjectOwnerId`/`bindProjectOwner` in `apps/api/src/services/project-access.ts`,
and `scopeMemoriesToCaller` in `apps/api/src/routes/memory.ts` — all assume
the same thing: "owner_id" identifies the one user who may read/write this
resource, and quota is metered per that one user.

This blocks anything resembling a real team/company account: nobody can share
a project with a teammate, there is no way to bill or meter usage at an
organization level, and there is no seat/role model above "you own it or you
don't." This document proposes an `organizations` + `organization_members`
schema addition and describes, table by table, how ownership, RLS, and
application code would evolve to support it — without discarding or
rewriting the ownership model that was just hardened.

## 2. Core schema change

Two new tables, both additive (nothing existing changes in Phase 1):

### `public.organizations`

| column       | type          | notes                                                   |
|--------------|---------------|----------------------------------------------------------|
| `id`         | `uuid` PK     | `default gen_random_uuid()`                               |
| `name`       | `text`        | `not null` — display name                                 |
| `slug`       | `text`        | `not null unique` — URL-safe identifier, lowercase        |
| `created_by` | `uuid`        | `references auth.users(id) on delete set null` — audit only, not an authorization check |
| `created_at` | `timestamptz` | `not null default now()`                                  |
| `updated_at` | `timestamptz` | `not null default now()`                                  |

`created_by` is deliberately `on delete set null`, not `cascade` — deleting
the user who happened to create an org must not delete the org itself or
orphan its other members. This mirrors the existing pattern in
`audit_logs`/`security_events` (`owner_id uuid references auth.users(id) on
delete set null`), which already treats "who did this" as soft-deletable
metadata rather than an ownership edge.

### `public.organization_members`

| column       | type          | notes                                                   |
|--------------|---------------|----------------------------------------------------------|
| `id`         | `uuid` PK     | `default gen_random_uuid()`                               |
| `org_id`     | `uuid`        | `not null references organizations(id) on delete cascade` |
| `user_id`    | `uuid`        | `not null references auth.users(id) on delete cascade`    |
| `role`       | `text`        | `not null check (role in ('owner','admin','member')) default 'member'` |
| `invited_by` | `uuid`        | `references auth.users(id) on delete set null`             |
| `joined_at`  | `timestamptz` | `not null default now()`                                   |
| unique       |               | `unique (org_id, user_id)` — one membership row per (org, user) pair |
| index        |               | `(user_id)` — see §4, RLS subqueries look up "which orgs is this user in" keyed by `user_id` first, which the `(org_id, user_id)` unique index does not serve efficiently |

`role` here is an **organization role** (owner/admin/member), a second and
orthogonal axis from `userRoleSchema`'s **platform role** (`user`/`admin`,
which gates `/admin` console access). A platform `"user"` can be an org
`"owner"`; a platform `"admin"` is not automatically an org member of
anything. Conflating these two would be a mistake — see the open questions in
§6 for why this still needs an explicit product decision on how they compose.

No cross-org uniqueness is enforced on `user_id` alone, so a user can belong
to more than one organization by design (see §6 on whether that's actually
the desired product behavior).

## 3. How the existing `owner_id`-scoped tables migrate

Grepping `owner_id uuid` across `supabase/migrations/*.sql` gives the real,
current list of tables that would need an org-aware equivalent:

- `projects`
- `memories`
- `decisions`
- `evidence_records`
- `claims`
- `project_state_snapshots`
- `graph_nodes`
- `graph_edges`
- `domain_events`
- `eval_runs`
- `agent_runs`
- `audit_logs` (nullable `owner_id`)
- `security_events` (nullable `owner_id`)
- `integration_accounts`
- `account_plans` (`owner_id` is the primary key here, not just a column)

A second tier of tables is ownership-scoped *indirectly*, via a `project_id`
or parent-row foreign key rather than their own `owner_id` column:
`repositories`, `repository_branches`, `memory_evidence`, `claim_evidence`,
`deployment_projects`, `deployments`, `deployment_logs`, `roadmaps`,
`milestones`, `tasks`. These inherit whatever ownership model their parent
row uses, so they don't need their own `org_id` column — only their RLS
policies (which already join up to the owner-bearing parent) need the same
OR-in-org-membership treatment described in §4.

A third tier — `tenant_subscriptions` and `byo_cloud_bindings` (referenced by
`apps/api/src/services/plan-quota.ts` and `apps/api/src/store/os-store.ts`) —
does **not exist as a Supabase/Postgres table today**. It's currently
in-memory/JSON state inside `os-store.ts` (`StoredTenantSubscription`,
`StoredByoCloudBinding`), keyed by `ownerId`. The same "additive `org_id`"
decision applies once/if these get promoted to real Postgres tables; noting
it here so a future migration doesn't reintroduce the single-owner model from
scratch. Likewise, patches/artifacts (`PatchArtifact` in `os-store.ts`) are
local-store-only today, keyed by `projectId`, and would inherit whatever
model `projects` ends up with rather than needing independent treatment.

### The actual question: does `owner_id` become `org_id`, or does `org_id` get added alongside it?

**Option A — breaking: rename/repurpose `owner_id` to mean `org_id`.**
Every table's ownership column changes meaning from "the one user who owns
this" to "the org that owns this." RLS collapses to a single clean policy
shape (`auth.uid() IN (SELECT user_id FROM organization_members WHERE org_id
= <table>.org_id)`) with no dual-checking, forever.

- *Pros*: one ownership model, permanently simpler RLS and application code,
  no risk of the two models drifting apart or someone forgetting to check
  both.
- *Cons*: requires a real backfill — every existing `owner_id` row needs an
  `org_id` assigned *before* the column can be renamed/repointed, which means
  deciding "what org does pre-existing user X's data belong to" for every
  user, for every table, as a single coordinated operation. It requires
  every read/write call site to switch from `.eq("owner_id", x)` to
  `.eq("org_id", x)` in the same deploy as the schema change, or reads break
  outright. That call-site set directly includes the tenant-isolation code
  that was just P0-hardened this session
  (`project-access.ts`'s `getProjectOwnerId`/`bindProjectOwner`,
  `memories.ts`'s owner-scoped queries, `memory.ts`'s `scopeMemoriesToCaller`)
  — rewriting an isolation boundary that was just fixed under a breaking
  schema change, in the same window, is exactly the kind of high-blast-radius
  change this document exists to avoid rushing. Rollback also means undoing
  both the schema change and the backfill, not just one or the other.

**Option B — additive: add a new, nullable `org_id` column alongside the
existing `owner_id`, leave `owner_id` exactly as-is.**

- *Pros*: zero-downtime, no backfill required to ship — `org_id` defaults to
  `null`, which just means "not shared to any org (yet)," and every existing
  row keeps working exactly as it does today via the unmodified `owner_id`
  check. This matches the migration style already used in this repo (e.g.
  `20260812010000_memories_created_by.sql`, an additive/idempotent
  `alter table ... add column if not exists`). Rollback is a single `drop
  column if exists org_id`, no data to restore. It does not touch the
  P0-hardened isolation code at all in Phase 1 — that code only needs to
  change once org_id starts actually being populated (Phase 2/3, see §5),
  on its own schedule, reviewed on its own merits.
- *Cons*: for a transition period (which could be long, or indefinite if
  Phase 4 is never reached — see §5), two ownership models coexist. Every
  RLS policy and every application-layer read/write path has to remember to
  check *both* `owner_id` and org membership via `org_id`, which is more
  code and more surface for someone to add a new owner_id-scoped table later
  and forget the org branch. `owner_id` never fully goes away as a concept —
  it likely becomes permanent "creator" metadata even under a mature org
  model, which is arguably correct (see product parallel: GitHub issues have
  both an author and a repo/org) but is a product decision, not just a
  technical one.

**Recommendation: Option B (additive).** The overriding reason is risk
sequencing, not just convenience: this codebase just went through a
P0-hardening pass on exactly the code a breaking `owner_id`→`org_id` rename
would force back open (`project-access.ts`, `memories.ts`, the new
`scopeMemoriesToCaller`). Additive lets the org tables and membership model
ship, get reviewed, and stabilize completely independently of that
isolation-critical code, and lets the eventual read/write cutover (Phase 3
below) happen as its own tightly-scoped, well-tested change instead of being
bundled into the initial schema work. Self-hosted / single-owner deployments
(`STUB_OWNER_ID`, `ATLAS_OWNER_ID` in `plan-quota.ts`) also have no concept
of an org today and should not be forced to acquire one just because the
schema changed — additive means they simply never populate `org_id` and
nothing about their behavior changes.

## 4. RLS policy changes

Today's pattern, unchanged for every `owner_id`-scoped table:

```sql
create policy "projects_owner_all"
  on public.projects for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
```

Once a table has an additive `org_id` column (Phase 2, §5), the org-aware
replacement ORs in an organization-membership check rather than replacing the
owner check:

```sql
create policy "projects_owner_or_org_all"
  on public.projects for all
  using (
    auth.uid() = owner_id
    or (
      org_id is not null
      and exists (
        select 1 from public.organization_members m
        where m.org_id = projects.org_id
          and m.user_id = auth.uid()
      )
    )
  )
  with check (
    auth.uid() = owner_id
    or (
      org_id is not null
      and exists (
        select 1 from public.organization_members m
        where m.org_id = projects.org_id
          and m.user_id = auth.uid()
      )
    )
  );
```

Two refinements worth calling out for a real implementation (not built in
this draft):

- **Role granularity.** The sketch above treats any org membership as
  sufficient for `for all` (select/insert/update/delete). A more careful
  version would split into separate `for select` (any member) and `for
  update/delete` (`role in ('owner','admin')`) policies, so an org
  `"member"` can read but not mutate a shared project. This is a product
  decision (§6) as much as a technical one — deferred to Phase 3 when reads
  actually become org-aware.
- **Performance.** The `exists (... where m.user_id = auth.uid())` subquery
  runs per row. `organization_members`'s primary uniqueness constraint is
  `(org_id, user_id)`, whose leading column is `org_id` — not ideal for a
  lookup keyed by `user_id` first. The draft migration adds an explicit
  `create index on organization_members (user_id, org_id)` for this reason.

## 5. Application-layer authorization changes

- **`resolveOwnerId` (`apps/api/src/services/plan-quota.ts`).** Today it
  resolves a single string id (`requestOwnerId ?? env.ATLAS_OWNER_ID ??
  STUB_OWNER_ID`) that is used both as the RLS-matching tenant key *and* as
  the quota-metering key (`getAccountPlan`, `assertCloudSlotAvailable`,
  `upsertTenantSubscription`, the `evalRunsPerDay`/`processAuditsPerDay`/
  `agentMessagesPerDay` axis checks). It needs an org-aware sibling —
  something like `resolveTenantScope(env, request)` returning `{ ownerId,
  orgId }`, where `orgId` is populated only when the request explicitly
  specifies an org context (e.g. a header or query param) *and* the caller's
  membership in that org has been verified against `organization_members`
  (otherwise 403, the same way `assertProjectWriteAccess` throws on an
  ownership mismatch today). Quota (`PLAN_CLOUD_LIMITS`, `tenant_subscriptions`)
  is a genuinely per-*org* concept in a team product ("your team's plan," not
  "your personal plan"), so `upsertTenantSubscription`/`getAccountPlan` would
  need an org-keyed variant. Because `tenant_subscriptions` isn't a real
  Postgres table yet (§3), this is more free to design cleanly, but the
  `STUB_OWNER_ID`/legacy-single-instance fallback path in `resolveTier` needs
  an explicit decision (§6) about whether self-hosted deployments get an
  implicit "personal org" or opt out of the org model entirely.

- **`getProjectOwnerId` / `bindProjectOwner` (`apps/api/src/services/project-access.ts`).**
  This is backed by a flat `Record<projectId, ownerId>` map
  (`readOwners`/`writeOwners`) plus an isolation audit log
  (`appendIsolationAudit`), not a `owner_id` SQL column directly — it's the
  local-store mirror of the same concept. The additive approach here is to
  *keep this mechanism exactly as-is* (it stays the "who claimed/bound this
  project" audit trail, unchanged) and add a parallel `getProjectOrgId
  (projectId)` lookup once `projects.org_id` exists. `assertProjectWriteAccess`
  /`assertProjectReadAccess` would then become: admin bypass (unchanged) →
  exact owner match (unchanged, so single-user projects keep working exactly
  as today) → **or** caller is a member of the project's org with sufficient
  role (new branch). Nothing existing is removed, only a new `or` branch is
  added — consistent with the additive schema direction in §3.

- **`scopeMemoriesToCaller` (`apps/api/src/routes/memory.ts`, added this
  session).** Currently `memory.ownerId === user.id`. Becomes something like
  `memory.ownerId === user.id || (memory.orgId != null &&
  callerOrgIds.includes(memory.orgId))`, where `callerOrgIds` is resolved
  once per request from `organization_members` (and cached for the request,
  not looked up per memory). This requires the `Memory` shape itself
  (`packages/shared/src/schemas/memory.schema.ts`) to eventually carry an
  optional `orgId`, mirrored from the new `memories.org_id` column — flagged
  here as necessary follow-up work, not touched in this round since it is a
  `.ts` file and out of scope for this planning pass.

- **`MemoryRepository` (`packages/database/src/repositories/memories.ts`).**
  Its `.eq("owner_id", ownerId)` filters (`listPending`, `listForHydrate`)
  would need an org-aware branch once `org_id` exists and is populated —
  either an `.or("owner_id.eq.X,org_id.in.(Y,Z)")` Supabase-js filter, or two
  merged queries. Important subtlety: RLS is the actual boundary once a
  request carries a real user JWT, but this repository is explicitly used
  for service-role writes/hydration that *bypass* RLS (see the comment
  already in that file: "Service-role clients... bypass RLS"), so the
  application-level filter here has to independently match whatever the RLS
  policy allows — if the two drift, either legitimate org data goes missing
  from hydration (filter too strict) or a service-role hydrate silently
  returns rows a plain authenticated client couldn't see via RLS (filter too
  loose, less dangerous here since it's server-side, but still a
  consistency bug worth testing for explicitly).

- **`userRoleSchema` / org role.** As noted in §2, organization role
  (owner/admin/member) is a new, separate enum from the existing platform
  `userRoleSchema` (`user`/`admin`). The natural home for it is a new
  `orgRoleSchema` in `packages/shared/src/schemas/auth.schema.ts` (or a new
  `org.schema.ts`) — not a modification of `userRoleSchema` itself, since
  platform-admin and org-owner answer different questions ("can this account
  see `/admin`" vs. "can this account manage this specific org's members").
  Not implemented in this round (no `.ts` files touched), flagged as the
  first real code change Phase 1 would need.

## 6. Phased rollout plan

**Phase 1 — additive org tables, no behavior change.**
Create `organizations` and `organization_members` (this draft migration).
RLS on both: a user can see orgs they belong to, and org owners/admins can
manage membership of their own org. No existing `owner_id`-scoped table
changes at all. Ship a minimal UI to create an org and invite members. Fully
backward compatible: a deployment where nobody creates an org sees zero
change in behavior, because nothing else references these tables yet.

**Phase 2 — additive `org_id` column + dual-write.**
For each table enumerated in §3 (tier 1), add a nullable `org_id uuid
references organizations(id) on delete set null` column via its own
additive/idempotent migration (matching the existing style, e.g.
`add column if not exists`). Application writes start populating `org_id`
*in addition to* `owner_id` (which keeps its current "creator" meaning) when
the request carries an org context. RLS policies gain the OR-in-org-membership
clause from §4. Existing owner-only rows are entirely unaffected — `org_id`
is `null`, the org branch of the policy never matches, behavior is identical
to today. A real backfill script (not written in this round) becomes
necessary only if the product wants pre-existing rows retroactively shared
into an org; it is not required for Phase 2 itself to be safe to ship.

**Phase 3 — switch reads to be org-aware.**
Every read path enumerated in §5 (`scopeMemoriesToCaller`, `MemoryRepository`
queries, `resolveOwnerId`/quota resolution, `project-access.ts`'s read/write
gates) is updated to consider `org_id`, not just `owner_id`. This is the
phase with the most application-code risk, since it touches the isolation
boundary directly — it should be scoped tightly (one resource type at a
time, starting with `projects` since everything else hangs off it) and
covered by the same kind of explicit isolation-audit tests that already
exist for `project-access.ts`, extended to cover "user in org A cannot read
org B's shared project" the same way they cover "user A cannot read user B's
project" today.

**Phase 4 — drop legacy owner_id-only assumptions.**
Only once Phase 3 is stable and product has answered the open questions in
§7 (in particular: does every resource end up belonging to an org, is there
a personal-org default) would it make sense to tighten constraints — e.g.
`org_id not null` on tables where the product has decided a resource must
always belong to an org. **This is the only phase that is genuinely
backward-incompatible**: a `not null` constraint rejects any row that hasn't
been backfilled, so it requires a real, tested backfill script run against
production data (most naturally: assign every still-null `org_id` to the
owning user's implicit personal org, if that's the direction chosen) *before*
the constraint can be added. Absent a clear product answer, it is entirely
reasonable to stop at Phase 3 indefinitely — dual ownership is a permanent,
acceptable state, not just a transitional one, if "does every resource
belong to an org" turns out not to have a clean yes.

## 7. Open questions for product / a human decision

These cannot be resolved by writing more code — they change what the schema
and RLS policies above should actually say:

1. **Can a user belong to more than one organization?** This draft's
   `organization_members` schema allows it (only `(org_id, user_id)` is
   unique, not `user_id` alone). If the product wants "one org per user,"
   the constraint tightens and `resolveTenantScope`'s "which org is this
   request for" logic simplifies (no org-switcher needed); if multi-org is
   real, the app needs an explicit "current org" concept per request/session.

2. **Is there an implicit "personal org" for every user?** If every user
   gets a personal org automatically (e.g. created by the same
   `handle_new_user()` trigger that already bootstraps `profiles` in
   `20260811200000_auth_profiles_roles.sql`), then Phase 4's `org_id not
   null` backfill becomes mechanical ("assign existing rows to the owning
   user's personal org") rather than a genuine product ambiguity. Without
   this, Phase 4 requires deciding what to do with every user who has data
   but has never explicitly joined or created an org.

3. **What happens to data owned by a user who is deleted, or who never joins
   any org?** `owner_id` today cascades on `auth.users` deletion for most
   tables (the row is deleted with the user). Should `org_id` behave the
   same way when an *org* is deleted (cascade — the shared data disappears
   with the org) or should it be `set null` (the data reverts to
   personal/unshared, owned only by whichever `owner_id` it still has)? This
   draft uses `on delete cascade` for `organization_members` (a membership
   row is meaningless without its org or user) but leaves the *resource*
   tables' eventual `org_id` FK behavior (cascade vs. set null) as an open
   choice to make per-table in Phase 2, not decided globally here.

4. **Org-level billing.** `account_plans` currently has `owner_id` as its
   *primary key* (one plan row per user). Moving billing to per-org (a
   team's plan, not a person's) means deciding whether `account_plans`
   gets a parallel `org_id`-keyed row type, or whether the primary key
   changes outright — which has direct implications for the Stripe webhook
   code (`apps/api/src/services/stripe.ts`) that this document does not
   attempt to resolve. Flagged as a real dependency, out of scope here.

5. **Role granularity and composition with platform role.** Is org
   `"member"` read-only or read-write? Does an org `"owner"` implicitly gain
   any platform-level capability, or are the two axes (§2, §5) fully
   orthogonal? This draft assumes fully orthogonal (a platform `"user"` can
   be an org `"owner"` with no special platform privileges), but that is a
   product call, not a technical default.

6. **Invitations.** `organization_members.joined_at` implies the row only
   exists once someone has *already* joined — there is no pending/invited
   state in this draft. A real invite flow (email invite, accept/decline,
   expiry) would need a separate `organization_invitations` table, deferred
   entirely out of this document's scope.

7. **Do self-hosted/local-only deployments participate in orgs at all?**
   `plan-quota.ts`'s `STUB_OWNER_ID`/`ATLAS_OWNER_ID` fallback exists for
   single-owner, non-multi-tenant deployments that predate any org concept.
   It needs an explicit decision on whether the org model is
   cloud/Supabase-only (self-hosted mode simply never has `organizations`
   rows and nothing changes for it) or whether it should eventually apply
   there too.
