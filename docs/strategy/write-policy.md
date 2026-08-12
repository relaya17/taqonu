# WRITE policy — governed remediation

**Theme #29 · ADR-015**

Atlas never mutates production code without an auditable path:

```
analyze → patch draft → evaluate → approve → apply → verify
```

## Surfaces

| Step | API / UI |
| --- | --- |
| Analyze / generate | `POST /api/v1/code/...` modes |
| Draft from audit | Constitution / audit → AUTO_FIX under `.atlas/remediation/` |
| Approve | `POST /api/v1/code/patches/:id/approve` · `/patches` |
| Apply | `POST /api/v1/code/patches/:id/apply` (WRITE session) |
| Verify | `POST /api/v1/remediation/drafts/:id/verify` |
| Rollback | `POST /api/v1/code/patches/:id/rollback` |

## Severity

| Severity | Policy |
| --- | --- |
| LOW | Optional auto-apply when `ATLAS_AUTO_APPLY_LOW` or `autoApplyLow` + WRITE session |
| MEDIUM | PR / human approve |
| HIGH | Recommend only |
| CRITICAL | Human required |

## Hard rules

1. WRITE routes require authenticated session (Auth-first when Supabase live)  
2. Apply only to configured `workspaceRoot`  
3. Evidence event after verify  
4. Editors (Cursor/Claude) remain workers — Atlas owns the gate
