# ADR-021 — Private-by-default and a separate Atlas Control Plane

**Status:** Accepted — amended 2026-09-02
**Date:** 2026-08-26  
**Product:** Atlas / ArletOS

## Amendment 2026-09-02 — Admin is the parent platform surface

The original decision placed `apps/admin` and `apps/control-plane` on one
**CONTROL** trust plane (`later apps/admin`). That made Owner Admin a Control
client/mirror.

**Superseded:** “CONTROL PLANE = apps/control-plane (later apps/admin)”.

**Now normative:**

```
PUBLIC          www — welcome, plan, approved docs
USER PLANE      apps/web + tenant API — includes Studio and tenant /admin
CONTROL         apps/control-plane :3100 — operational supervision
ADMIN           apps/admin :3200 — platform supervisor over Control and Studio
```

- Atlas Admin supervises Control and Studio. It is not a second Control dashboard.
- Control remains the operational layer (connected apps, processes, operational agents).
- Studio remains `apps/web` `/[locale]/studio`.
- `apps/web/app/admin` is **tenant** administration. Customer role `admin` is not Atlas Admin.
- Owner / operator roles are unchanged. User-directory UI still must not grant them.

Private-by-default, controlled egress, and self-governance are unchanged.

## Context

Atlas stores source code, functions, architecture, evidence, memory, claims,
project graphs, agent traces, and audit logs. Marketing pages may be public.
Everything else must be private-by-default and non-discoverable.

A second need: the founder who runs Atlas is not a customer `admin`. Customer
admin manages a tenant. Atlas Owner / Operator governs Atlas itself.

`robots.txt` / `noindex` reduce indexing. They are **not** access control.

Cloud LLMs are egress. If code is sent to a provider, that provider is in the
processing chain. Privacy requires **controlled egress**, not a false promise
that data “never leaves.”

## Decision

### Four official principles

1. **PRIVATE-BY-DEFAULT** — No internal code, evidence, memory, architecture,
   or tenant data is publicly discoverable or indexable.
2. **CONTROLLED-EGRESS** — No sensitive data leaves Atlas unless an explicit
   policy permits the destination and purpose (sanitize, minimize, audit).
3. **SEPARATE-CONTROL-PLANE** — Atlas Owner administration is isolated from
   ordinary tenant/user administration.
4. **SELF-GOVERNANCE** — Atlas may inspect, diagnose, test, and propose
   changes to itself, but cannot silently weaken its own security, erase its
   audit trail, or self-grant authority.

Detect → analyze → propose → policy/risk → human approval → apply → verify → audit.

### Trust planes (one monorepo)

Historical (2026-08-26): PUBLIC / USER / CONTROL (Admin later folded into Control).

Amended (2026-09-02): PUBLIC / USER / CONTROL / ADMIN — see Amendment above.

```
PUBLIC          www — welcome, plan, approved docs
USER PLANE      apps/web + tenant API — authenticated + authorized + owned
CONTROL         apps/control-plane :3100 — owner/operator operational plane
ADMIN           apps/admin :3200 — owner platform supervisor
```

Roles:

| Role | Meaning | Granted how |
| --- | --- | --- |
| `user` | Tenant principal | Register |
| `admin` | Customer / org admin | UI/API, MFA required |
| `operator` | Atlas Control Plane operator | Env allow-list only |
| `owner` | Atlas Owner (root authority) | `ATLAS_OWNER_EMAIL` / bootstrap env only |

The user-directory UI **must not** grant `operator` or `owner`.

### Layers

1. Authentication — every non-public endpoint requires a valid session.
2. Authorization — session is not enough; resource must belong to the actor.
3. RLS + grants — service-role keys stay server-side.
4. No indexing — robots/noindex for product routes; not a security control.
5. Egress — classify → allow/deny → minimize → approved destination → audit.

### Control Plane process

`apps/control-plane` (port 3100) is a distinct runtime trust boundary. It must
not be reachable because “someone knows the URL.” Bind loopback by default;
require a bearer token except for liveness `GET /api/v1/status`.

P1 (incremental): `apps/admin` Owner UI on :3200; Control API application
registry + Atlas Gateway events/ops; data classification + egress policy on
LLM call sites; DEF-000 self-audit (detect/propose only); audit DELETE/PUT/PATCH
returns 405. Break-glass and a physically separate Control Plane DB remain later.

## Consequences

- Default-deny API hook with an explicit public allow-list.
- Studio / graph / code reads require auth and project ownership.
- `/api/v1/admin/command-center` and Oracle require `owner` or `operator`.
- Customer `admin` remains for tenant user directory, not platform governance.
- Cron `GET|POST /api/v1/knowledge/refresh` is on the public list only so
  `CRON_SECRET` bearer can reach the handler; the handler still authenticates.
