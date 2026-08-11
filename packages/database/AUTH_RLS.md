# Auth + RLS readiness

Local `osStore` remains primary persistence. Supabase is optional dual-write when `SUPABASE_URL` + live `SUPABASE_SERVICE_ROLE_KEY` are set (`isLiveSupabase` in `src/persist.ts`).

## API enforcement (always on)

Write mutations (patch approve/apply/rollback, architecture contract PUT, workspace-root PUT, billing plan/credits, admin routes) require a signed `atlas_session` cookie via `requireSignedInForWrite` / `requireAdmin`.

`GET /api/v1/auth/session` returns `role` + `capabilities` for the web shell.

## Cloud RLS (activates only on live Supabase)

SQL lives in the monorepo canonical path:

- `supabase/migrations/20260811000000_init.sql` — projects + baseline RLS
- `supabase/migrations/20260811120000_architecture_v1.sql` — evidence_records / claims
- `supabase/migrations/20260812003000_rls_projects_evidence_tenant.sql` — hardens tenant policies + fills junction-table gaps

Apply with `supabase db push` / migration runner against the project. Until applied and clients use user JWTs (anon key + `auth.uid()`), RLS does not constrain the API’s service-role dual-write path.

## Schema helpers in this package

- `ProjectRepository` inserts `owner_id` on `projects`
- No direct evidence repository yet — evidence tables match Architecture v1 migrations only
