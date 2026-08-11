# ADR-012: Auth (Google/GitHub) + Admin console + a11y/responsive

## Status

ACTIVE

## Context

Users need:

1. Full **accessibility** and **responsive** product shell
2. A separate **admin** URL (`/admin`)
3. **Register / login**, including **Google** and **GitHub** OAuth

## Decision

### 1. Auth model

| Mode | When | Mechanism |
| --- | --- | --- |
| Local | `SUPABASE_*` placeholders / personal instance | Email+password in `.atlas/users.json` (scrypt), signed session cookie |
| Cloud | Live Supabase | Supabase Auth OAuth (Google, GitHub) + email; profiles synced |

Session: HTTP-only cookie `atlas_session` (HMAC with `COOKIE_SECRET`).  
API: `GET /api/v1/auth/me`, `POST register|login|logout`, `GET /api/v1/auth/providers`.

Roles on profile: `user` | `admin`.  
Bootstrap admin: `ATLAS_ADMIN_EMAIL` (first matching login/register becomes admin) or explicit flag in local store.

### 2. Admin URL

Separate route tree **outside** locale AppShell:

```
/admin          — dashboard (admin role required)
/admin/login    — admin login
/admin/users    — user directory (local + stub cloud)
```

Product app stays under `/he|en|ar/...`.

### 3. Accessibility + responsive

- Collapsible drawer on small screens; permanent from `md`
- Skip link → `#main-content`
- Landmarks, `aria-*`, focus-visible rings, ≥44px touch targets
- RTL preserved for he/ar

### 4. Non-goals (this ADR)

- Full multi-tenant org RBAC
- SMS/magic-link (can add later via Supabase)
- Replacing Cursor/IDE

## Consequences

- Migration: `profiles.role`, auth trigger for new users
- Web: `@supabase/supabase-js` for OAuth when configured
- Middleware: leave `/admin` outside next-intl matcher
