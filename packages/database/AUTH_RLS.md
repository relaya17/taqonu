# Auth + RLS readiness

Local `osStore` remains primary **persistence** for product state. Supabase is optional dual-write when `SUPABASE_URL` + live `SUPABASE_SERVICE_ROLE_KEY` are set (`isLiveSupabase` in `src/persist.ts`).

## Persistence durability (Theme #25 — MVP, 2026-08-12)

**Not multi-region HA SaaS** — durable local store + optional cloud dual-write/recovery.

| Layer | Behavior |
| --- | --- |
| Local primary | `.atlas/store.json` (override: `ATLAS_STORE_PATH`) |
| Atomic flush | Write temp → rename/copy; refresh sibling `.bak` on every persist (`apps/api/src/store/store-io.ts`) |
| Load recovery | Parse primary; on corrupt/missing fall back to `.bak` |
| Heartbeat backups | Optional: `ATLAS_STORE_BACKUP_INTERVAL_MS` copies into `.atlas/store-backups/` (retain `ATLAS_STORE_BACKUP_KEEP`, default 5) |
| Cloud dual-write (when live) | **projects**, **memories**, **knowledge_chunks**, **decisions**, **account_plans** (tenantSubscriptions) |
| Canonical audit (when live) | **audit_logs** — different from the row above: governed-action audit (`apps/api/src/services/audit-log.ts`'s `appendCanonicalAuditEntry`) treats Postgres as canonical, not best-effort, and fails closed on a Vercel-production write failure instead of silently falling back to local disk. See "Canonical audit persistence (P0, 2026-09-05)" below. |
| QA patterns | Persist in local store meta (`qa.portfolioPatterns`); cross-project lessons also dual-write as portfolio memories |
| Startup hydrate | If local store is essentially empty and Supabase is live, API startup pulls projects/memories/decisions/account_plans (`tryFetchCloudDurabilityBundle` → `hydrateOsStoreFromCloudIfEmpty`) |

HA path beyond MVP: managed Postgres PITR + multi-AZ, object-store snapshots of `.atlas/`, and promote cloud to source-of-truth (local becomes cache). The audit_logs canonicalization below is a first, narrower instance of that same direction, scoped to governed-action audit only.

## Canonical audit persistence (P0, 2026-09-05)

Unlike every row in the table above, governed-action audit evidence is not
best-effort dual-write: `public.audit_logs` (schema in
`supabase/migrations/20260811000000_init.sql`, extended by
`20260905000000_audit_logs_canonical_chain.sql`) is canonical whenever live
Supabase credentials are configured (`isLiveSupabase`), with the local
NDJSON file (`.atlas/audit/audit.ndjson`) kept as a secondary/resilience
copy, not the other way around. `seq`/`prev_hash`/`hash` are assigned
server-side by a `BEFORE INSERT` trigger holding a lock on a singleton
"chain tip" row, so concurrent writers cannot race the way the NDJSON
file's read-last-line-then-append pattern could.

Failure semantics (see `docs/architecture/ATLAS_MASTER_TRUTH.md` section 65
for the full write-up): a Postgres write failure on Vercel production
fails closed (throws — a governed action must not report success without
canonical audit evidence); the same failure on the private VM, with the
NDJSON secondary write succeeding, degrades explicitly instead (the event
is still durably recorded, just not in the canonical store). Postgres not
configured and not Vercel-production behaves exactly as before this
change: NDJSON-only, no throw.

Scope: only the governed-execution (`governed-execution.ts`) and
synthetic-universe governance (`synthetic-universe-run.ts`) audit paths go
through the canonical writer today. `audit-bridge.ts`, `os-store.ts`'s
internal `appendAudit`, and the remaining `appendUnifiedAuditEntry` call
sites elsewhere in the codebase are unchanged (NDJSON-only), a named,
deliberate scope boundary — not every governed-action-adjacent audit call
site was converted in this pass.

## Identity + roles — Auth is source of truth when live (2026-08-12)

When Supabase is live:

1. Prefer the Supabase Auth access token in HttpOnly `atlas_sb_session` for **identity + roles**.
2. Role comes from JWT `app_metadata.atlas_role` (mirrored to `public.profiles.role`).
3. Local `atlas_session` + `.atlas/users.json` are **offline / stub / Auth-down fallback only**.

When Supabase is not live (placeholder keys / personal instance), local session remains the only path — stub mode unbroken.

Resolution lives in `apps/api/src/services/resolve-identity.ts` (`resolveRequestIdentity` sync for guards; `resolveRequestIdentityAsync` refreshes stale tokens for `/auth/session` + cloud writes).

## API enforcement (always on)

Write mutations (patch approve/apply/rollback, architecture contract PUT, workspace-root PUT, billing plan/credits, admin routes) require a signed-in principal via `requireSignedInForWrite` / `requireAdmin` (Auth-first identity).

`GET /api/v1/auth/session` returns `role` + `capabilities` for the web shell.

## Cloud RLS — enforced per-user when Supabase is live

SQL lives in the monorepo canonical path:

- `supabase/migrations/20260811000000_init.sql` — projects + baseline RLS
- `supabase/migrations/20260811120000_architecture_v1.sql` — evidence_records / claims
- `supabase/migrations/20260811200000_auth_profiles_roles.sql` — `profiles.role` + Auth trigger
- `supabase/migrations/20260812003000_rls_projects_evidence_tenant.sql` — hardens tenant policies + fills junction-table gaps

Apply with `supabase db push` / migration runner against the project.

**Identity plumbing that makes RLS actually bind:**

- `apps/api/src/services/supabase-session.ts` mirrors each local user into
  Supabase Auth with the **same id** (`ensureSupabaseAuthUser`), writes
  `app_metadata.atlas_role` + `profiles.role` (`syncSupabaseAuthRole`), signs
  them in to get a real Supabase access token (`signInSupabaseUser`), and stores
  it server-side in an HttpOnly `atlas_sb_session` cookie — separate from
  the app’s own `atlas_session` cookie, never returned in any API response
  body. `resolveRequestSupabaseAccessToken` transparently refreshes it via
  the stored refresh token when stale.
- OAuth users skip the mirror step: the browser already holds a real
  Supabase session from its own OAuth round-trip
  (`apps/web/.../auth/callback`), which is forwarded to
  `POST /api/v1/auth/oauth/sync` and stored the same way; role is synced into
  Auth metadata / profiles on that path.
- `apps/api/src/services/cloud-identity.ts` resolves, per request, the
  signed-in user’s own id (Auth-first) plus their Supabase access
  token, and `packages/database/src/client.ts#createUserScopedClient` builds
  a Supabase client authenticated as that user. `tryPersistProjectToSupabase`
  / `countCloudProjects` use it when available — routing project/evidence
  writes through a client RLS actually applies to (`auth.uid() = owner_id`)
  instead of the service-role client, which still bypasses RLS.
- Fallback: when no session exists (unauthenticated / system-initiated
  writes — webhooks, background jobs), `resolveOwnerId` falls back to
  `ATLAS_OWNER_ID`/`STUB_OWNER_ID` and the service-role client, exactly as
  before — personal single-owner deployments are unaffected.

**OAuth-after-local-signup id reconciliation (2026-08-12):**

Pre-existing email/password users who later link GitHub/Google used to keep
their original local UUID while the OAuth access token carried a different
Supabase `sub` — so `auth.uid()` and `owner_id` could diverge. That path is
now reconciled on `POST /api/v1/auth/oauth/sync` (and repaired on password
login if a token `sub` still drifts):

1. `upsertOAuthUser` rewrites the local user id to the OAuth/Supabase id.
2. `finalizeIdentityReconciliation` (`identity-reconcile.ts`) rekeys
   `tenantSubscriptions` in osStore and, when Supabase is live, best-effort
   migrates cloud `owner_id` rows (projects/memories/evidence/…) via the
   service-role client, then removes the stale mirrored Auth user so
   password login cannot mint a token under the old id again.

Fresh OAuth signups and fresh email/password signups remain consistent from
the start (mirror uses the same id + `atlas_role`).

**Residual edge cases (documented, rare):**

- If cloud `owner_id` migration fails mid-flight (Supabase down), local
  session already uses the OAuth id — new writes are consistent; orphaned
  rows under the old id need an admin rekey once cloud is back.
- If the OAuth id already belongs to a *different* local account (email
  collision), the rewrite is skipped to avoid clobbering that account.
- Password is copied onto the OAuth Auth user only when available at
  login-time repair; OAuth-only link without a subsequent password login
  may require a password reset for email/password sign-in against Supabase.
- If a live JWT lacks `app_metadata.atlas_role` (pre-migration user), login /
  oauth/sync pushes the local role into Auth + profiles and re-mints the
  token; until then resolve falls back to the local mirror role for that id.

## Schema helpers in this package

- `ProjectRepository` inserts `owner_id` on `projects`
- `MemoryRepository` / `DecisionRepository` / `AccountPlanRepository` dual-write + list-for-hydrate
- No direct evidence repository yet — evidence tables match Architecture v1 migrations only
