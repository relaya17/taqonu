# ADR-011: Freemium + external database + cloud project quota

## Status

ACTIVE

## Context

Users need:

1. An **external** primary database (not embedded SQLite-only)
2. A **free** tier with a limited number of cloud projects
3. A **paid** tier for more cloud capacity
4. Local work that stays unlimited; cloud sync is the gated resource

## Decision

### 1. External datastore

Keep **Supabase PostgreSQL** (ADR-002) as the cloud datastore via `SUPABASE_*` + `DATABASE_URL`.

| Mode | Store | Quota |
| --- | --- | --- |
| Local (default) | `.atlas/store.json` | Unlimited projects |
| Cloud | Supabase `projects` (+ RLS `owner_id`) | Limited by plan |

Local remains the personal-instance source of truth until a project is explicitly uploaded.

### 2. Freemium plans (product)

| Tier | Cloud projects | Notes |
| --- | --- | --- |
| `free` | **3** | Default |
| `pro` | **100** | Paid upgrade (Stripe later) |

Env overrides (ops / personal instance):

- `ATLAS_PLAN=free|pro`
- `ATLAS_CLOUD_PROJECT_LIMIT` (optional hard override)
- `ATLAS_OWNER_ID` (uuid; stub until real auth)

### 3. Enforcement points

Quota applies only when writing to **cloud**:

- `POST /api/v1/projects` with `syncToCloud: true`
- `POST /api/v1/projects/:id/cloud` (upload existing local project)
- Future: discover/import paths that request cloud sync

Exceeded → `AtlasError("QUOTA_EXCEEDED")` (HTTP **402**) with upgrade hint.

### 4. Billing

**Now:** plan in local store + env; `POST /api/v1/billing/plan` for explicit tier set (personal / staging).

**Later:** Stripe Checkout → webhook updates `account_plans` in Postgres. No Stripe in this ADR.

### 5. Auth

Until multi-user auth ships, all cloud rows use `ATLAS_OWNER_ID` (or the documented stub UUID). RLS still keys on `owner_id`.

## Non-goals

- Do not replace local store with cloud-only
- Do not require payment for local ArletOS
- Do not implement Stripe in this change set

## Consequences

- Shared plan schemas + migration `account_plans`
- API: `GET /api/v1/billing/plan`, upload-to-cloud route, quota checks
- UI: Plan / Cloud page + upload controls on Projects
