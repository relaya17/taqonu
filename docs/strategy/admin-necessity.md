# Admin Necessity — Product Intelligence Rule

**Status:** Living guidance (pairs with ADR-020 Constitution)  
**Date:** 2026-08-11  
**Product:** Atlas / ArletOS

## Principle

**Admin is a business/security need, not a fixed technical requirement.**

Atlas must **not** scaffold `/admin` (or a separate Admin app) into every
project just because “that’s how apps are built.”

Atlas **must** ask and detect:

```
Does this product require administrative capabilities?
        ↓
YES / NO
        ↓
What type?
  Internal · Customer · Super · Support · Operations · Finance · Content · Security
        ↓
What separation?
  In-app /admin  ·  Separate FE (admin.app)  ·  RBAC-only (no console)
        ↓
Enforce on server (AuthN → AuthZ → RBAC → resource perms → audit)
```

## Three valid surfaces (when YES)

1. **In-app** — `app.com/admin` — small/medium products  
2. **Separate frontend** — `admin.app.com` + shared API/DB — strong isolation  
3. **RBAC only** — protected routes + permissions + audit — no dedicated console  

## Non-negotiable security

`/admin` is **not** security. Never rely on frontend-only:

```ts
if (user.role === "admin") { /* show UI */ }
```

Enforcement chain:

```
Request → Authentication → Authorization → RBAC/ABAC → Resource permission → Action → Audit
```

## Constitution checks

| Id | Meaning |
| --- | --- |
| `sec.admin_necessity` | Decide need/type/surface — don’t default-build |
| `sec.admin_server_authz` | If admin exists or is needed → server enforcement |
| `sec.admin_overbuild` | Admin UI without business signals → warn (complexity tax) |

Implementation: `packages/code-intelligence/src/admin-necessity.ts` + detectors in
`constitution-runner.ts`.

## Fit with Atlas vision

This is **Omission Detector** territory: notice what the founder forgot
**and** refuse unnecessary complexity. Same spirit as local connectors with
**explicit project permissions** — power without default sprawl.

## Future: Admin Oracle / Command Agent

Product roadmap item **A1** in [`ATLAS-TRUTH-10.md`](./ATLAS-TRUTH-10.md):

- Premium admin command center managed by one grounded agent  
- Detect bugs / unstable versions / crashes / deploy failures  
- Daily allowlisted hi-tech + defensive cyber briefs (CVE/CISA/vendors/law)  
- Automate propose→approve→apply with evidence; never unauthorized offense  

Do **not** scaffold this agent into customer apps by default — only when
admin necessity = YES and Atlas itself needs an ops console.
