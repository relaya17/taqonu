# Atlas gap matrix (authoritative)

**Date:** 2026-09-18  
**HEAD baseline:** `212c077` plus the 2026-09-18 working-tree isolation/landscape pass  
**Production gate:** NOT PRODUCTION READY  

This is the current G1–G7 classification. Do not quote August 2026 audit
files, `atlas-gap-analysis-staged-roadmap.md`, or MASTER TRUTH §64
“CODE-COMPLETABLE NONE” as live status.

Categories: **G1** code defect · **G2** code-completable hardening ·
**G3** implemented / not fully proven · **G4** infrastructure / external ·
**G5** product / architecture decision · **G6** accepted invariant ·
**G7** documentation / contract (claims about current implementation).

| ID | Gap | Current Reality | Category | Fix Today? | Evidence | Remaining Requirement |
| -- | --- | --------------- | -------- | ---------- | -------- | --------------------- |
| GAP-001 | Control Plane actor identity spoofable via body `setBy`/`decidedBy` | Bearer maps to `cp:service`; body strings ignored | G3 | Done in working tree | `governed-lifecycle-handoff.ts`, kill-switch/approvals tests | Live CP→API hop on private plane |
| GAP-002 | GitHub/local PAT connection shared across users | Per-owner maps; routes pass `user.id`; raw token not in JSON | G3 | Done | `os-store.ts`, `connections.test.ts` | Live multi-user session on daemon |
| GAP-003 | Metrics/performance/analytics/cache/readiness leak | Admin-only ops GETs; readiness filtered by `canReadProjectScoped` | G3 | Done | `operational-surfaces.test.ts` | Live session-gate HEAD on daemon |
| GAP-004 | Cloud quota counted instance-wide | `countOwnedCloudLinks(ownerId)` via `getProjectOwnerId` | G3 | Done | `plan-quota.test.ts` | Live Supabase subscription row |
| GAP-005 | Decision list/get/transition IDOR | Optional `ownerId`; `canReadDecision`; recon fail-closed on unowned global | G3 | Done | `decisions.test.ts`, `state-reconciliation.test.ts` | Live Postgres decision rows |
| GAP-006 | Verdict / report / executive-report IDOR | `assertProjectReadAccess` on those GETs | G3 | Done in `1758563` | report/verdict route tests | Live project rows |
| GAP-007 | Memory write/export cross-tenant | Write/export owner filter; `"global"` is `projectId: null` still tenant-owned | G3 | Done in `1758563` | memory route tests | Live memory dual-write |
| GAP-008 | Global-memory reconciliation mixed tenants | `memoriesForProjectReconciliation` tenant filter | G3 | Done in `212c077` | reconciliation tests | Live recon job |
| GAP-009 | Unauthenticated HEAD bypassed GET allow-list | Fastify HEAD follows GET allow-list | G3 | Done in `212c077` | `private-by-default.test.ts` | Daemon with global `onRequest` |
| GAP-010 | Exclusive STARTED occupancy | In-process + SQL `mark_started` exclusive; second mark rejected | G3 | Done in `1758563` | `live-approval-requests.test.ts`, migration file | Apply migration on production PostgreSQL |
| GAP-011 | Control `/internal/*` without session | Session gate on Control internal routes | G3 | Done in `1758563` | `atlas-session-gate.ts` tests | Live Control daemon |
| GAP-012 | Daily eval/audit/message meters shared | Per-owner nested meters; instance totals remain for watchdog | G3 | Done this pass | `plan-quota.test.ts` owner isolation | Live plan GET as each tenant |
| GAP-013 | `GET /eval/runs` listed every run | Admin-only; POST requires signed-in + owner quota | G3 | Done this pass | `eval.routes.test.ts` | Live admin session |
| GAP-014 | Architecture contract GET IDOR | `requireUser` + `canReadProjectScoped` | G3 | Done this pass | `engineering-audit.test.ts` | Live project-scoped GET |
| GAP-015 | Audit/constitution report lists process-global | Admin-only list/get | G3 | Done this pass | `engineering-audit.test.ts` | Live admin session |
| GAP-016 | Intelligence lessons/signals read all audits | Admin-only; catalog marketplace stays public | G3 | Done this pass | `intelligence.test.ts` | Live admin session |
| GAP-017 | Constitution/audit-engine POST unauthenticated in route tests | Signed-in; project write when `projectId` set | G3 | Done this pass | `engineering-audit.test.ts` 401s | Live signed-in Studio run |
| GAP-018 | Kernel eval/lesson POST unsigned in route tests | `requireSignedInForWrite` | G3 | Done this pass | `kernel.test.ts` | Live signed-in call |
| GAP-019 | Exclusive STARTED on real PostgreSQL | SQL exists; this workstation has no live `:54322` | G4 | Prepare only | Migration in repo; Docker Desktop down | Production PostgreSQL apply + concurrent proof |
| GAP-020 | Ubuntu + Tailscale private plane | systemd/nginx artifacts exist; VM `100.93.71.107` last offline | G4 | Prepare only | `docs/deployment/private-plane.md` | Reachable VM + Tailscale |
| GAP-021 | Live Supabase/Postgres API health | Local JSON store; health can report DB when configured | G4 | Prepare only | `health-check.ts` | Live credentials |
| GAP-022 | Studio `.env.local` | `replace-me` / missing; `:3000` EADDRINUSE or down | G4 | Prepare only | `apps/web` env contract | Operator env, not committed secrets |
| GAP-023 | Offsite DR destination | Local NDJSON DR drill exists; no cloud bucket client | G4 | Prepare only | remaining-work #4 | Owner sets `ATLAS_OFFSITE_BACKUP_DIR` or bucket |
| GAP-024 | Sigstore/cosign signing | Fail-closed unsigned CLI; `ATLAS_SIGNING_IDENTITY` unset | G4 | Prepare only | `pnpm supply-chain:sign` REFUSE | Real signing identity + verifier |
| GAP-025 | External pentest | Scope package READY; no engagement | G4 | Prepare only | `docs/security/pentest-readiness.md` | Vendor engagement |
| GAP-026 | omit-`agentId` memory retrieve | Human surfaces still see `allowedAgents` rows; not a silent omit policy | G5 | No | remaining-work B1 | Owner policy: fail-closed vs human visibility |
| GAP-027 | ADR-022 sibling execute | Observe/evaluate only except `def-000` | G5 | No | `ADR-022-OWNER-DECISION-REQUEST.md` | Owner amend or keep observe-only |
| GAP-028 | SSO/SAML/SCIM | Local+Supabase OAuth Google/GitHub; no SAML/SCIM | G5 | No | ADR-012 | Enterprise identity product decision |
| GAP-029 | Organization / workspace RBAC | Tenancy is `ownerId`; `DRAFT_multi_tenant_orgs.sql` stays draft | G5 | No | ADR-012 | Org model decision |
| GAP-030 | GitHub App installations instance-level | Per-owner PAT maps exist; App install table is instance-wide | G5 | No | `os-store.ts` githubAppInstallations | Per-owner App vs personal-instance |
| GAP-031 | A2A / enterprise agent identity | Fabric catalog + `cp:service`; no A2A protocol | G5 | No | staged roadmap § Track B | Product scope |
| GAP-032 | SIEM / SAST / dependency-security product integrations | Evidence/SECURITY ingestion exists; not a scanner replacement | G5 | No | gap-vs-world-class | Feed vs replace scanners |
| GAP-033 | Policy simulation / compensating actions | Policy engine on execute path; no simulation product | G5 | No | `authorizeEntityAction` | Product scope |
| GAP-034 | Memory retention/deletion policy | No TTL/deletion product; owner isolation exists | G5 | No | memory schema | Retention product decision |
| GAP-035 | Diagnosis / prediction / self-healing | Not implemented as product; auto-apply LOW drafts exist | G5 | No | remediation-pipeline | Do not invent as closure |
| GAP-036 | Advanced analytics | Admin usage analytics; not BI/org analytics | G5 | No | `GET /analytics/usage` admin | Product scope |
| GAP-037 | Shared Git architecture | Local folder + GitHub PAT per owner; no shared org Git | G5 | No | connections routes | Product scope |
| GAP-038 | HTTP 202 APPROVAL_REQUIRED | Pending, not executed | G6 | No | approvals routes | Do not treat as execute |
| GAP-039 | Occupancy vs exactly-once | FULFILLED/FAILED/OUTCOME_UNKNOWN/FINALIZE_INCOMPLETE; not external exactly-once | G6 | No | MASTER TRUTH §6 | Do not claim broker exactly-once |
| GAP-040 | Kill Switch / session SoD / executeTool | Accepted; SoD forbids self-approval on live decide | G6 | No | prior STOP audits | Do not reopen |
| GAP-041 | Web ≠ Control planes | ADR-021 separate ports/projects | G6 | No | ADR-021 | Do not merge planes |
| GAP-042 | Unowned project read | Readable when `ownerId` unset | G6 | No | `project-access.ts` | Personal-instance bootstrap |
| GAP-043 | Workers remain workers | Cursor/Claude Code are workers; Atlas is truth/QA/governance | G6 | No | gap-vs-world-class | Do not clone IDE |
| GAP-044 | Connected apps except def-000 | CaseFlow/Civio/HotelOS/BrokerOS/LexStudy/Vantera observe/evaluate/inventory | G6 | No | CONNECTED_APPLICATION_RUNTIME | Until GAP-027 decides execute |
| GAP-045 | Plugin sandbox / arbitrary tool runtime | Allow-listed internal tools; not general sandbox | G6 | No | staged roadmap historical | Intentional non-goal until G5 |
| GAP-046 | Historical “CODE-COMPLETABLE NONE” | §64 stamped stale; live pointer is this file + remaining-work 2026-09-18 | G7 | Done | MASTER TRUTH §64 note, §67 | Do not quote §64 as current |
| GAP-047 | August security audit P0s as live defects | Those P0s were later fixed; file is historical | G7 | Done | banner on `atlas-security-intelligence-audit.md` | Read this matrix |
| GAP-048 | Staged roadmap Organization=Missing as a bug | Roadmap Track B/C; current tenancy is ownerId | G7 | Done | banner on staged roadmap | G5 not G1 |
| GAP-049 | `STUB_OWNER_ID` fallback | Only when no identity and no `ATLAS_OWNER_ID`; authenticated paths pass `user.id` | G6 | No | `resolveOwnerId` | Personal-instance billing |
| GAP-050 | Canonical audit | API NDJSON (+ optional Supabase dual-write when live); CP in-memory is not canonical | G3 | Code done | `audit-log.ts` | Live Postgres chain verify |
| GAP-051 | Multi-process occupancy | Exclusive SQL designed; in-process mutex for local JSON | G3 | Code done | migration + in-process mark | G4 live Postgres |
| GAP-052 | SBOM / provenance / release gate | SBOM valid; unsigned; `releaseReady: false`; fail-closed sign | G3 | Code done | supply-chain scripts | G4 signing identity |
| GAP-053 | PartnerAuditIntake / experts catalog | Catalog GETs; analytics now admin | G6 | No | public-routes + requireAdmin analytics | Catalog is not tenant data |
| GAP-054 | GET `/experts`, `/agents`, kernel status | Signed-in catalogs, not tenant records | G6 | No | route handlers | Do not admin-gate catalogs |
| GAP-055 | Live ML embeddings | Cosine when provider configured; else lexical-hash | G4 | No | remaining-work B2 | External embedding provider |
| GAP-056 | Design-partner live proof | Strategy remaining, not a code defect | G5 | No | gap-vs-world-class | Human partner runs |
| GAP-057 | Login→register dropped allowlisted `next` | `useSearchParams` + `audit-return-path.ts` | G1 | Done this pass | auth pages + browser `:3000` | none local |
| GAP-058 | Auth fields hardcoded `dir="rtl"` | `inputDirForLocale` | G2 | Done this pass | login/register/forgot/reset | none |
| GAP-059 | AppShell `keepMounted` duplicated nav | `keepMounted: false` | G2 | Done this pass | AppShell, AdminShell | none |
| GAP-060 | `commercial.test.ts` leaked `NODE_ENV=production` | Pin `NODE_ENV=test`; vitest `env` | G3 | Done this pass | commercial.test.ts 8/8 under leaked production | Do not weaken skip-audit throw |
| GAP-061 | OAuth callback ignored allowlisted `next` | `allowlistedAuditNext` on callback | G1 | Done this pass | callback/page.tsx | Live IdP is G4 |
| GAP-062 | Patches desk ignored `?project=` | `useProjectQueryParam` | G2 | Done this pass | PatchesPanel.tsx | none |
| GAP-063 | Bound Studio check pickers were dead | Hide picker when `boundProjectId` | G2 | Done this pass | Health/Truth/Readiness/ProcessAudit | none |
| GAP-064 | Studio project URL + projects error | `router.replace` + `isError` Alert | G2 | Done this pass | studio/page.tsx | none |
| GAP-065 | Companion chip ignored locale title | `title()` for collapsed label | G2 | Done this pass | AiCompanionBar.tsx | none |

## Counts (this working tree)

| Class | Count | Meaning |
| --- | --- | --- |
| G1 remaining | **0** | No confirmed open code defect after this pass |
| G2 remaining | **0** | Hardening that the architecture already supports is landed locally |
| G3 | 001–018, 050–052, 060 (22) | Code+tests exist; live infra proof missing; GAP-060 is test isolation |
| G4 | 019–025, 055 (8) | Outside the repository |
| G5 | 026–037, 056 (13) | Owner/product decisions; do not invent |
| G6 | 038–045, 049, 053–054 (11) | Intentional boundaries |
| G7 remaining for current-implementation claims | **0** | Stale current-status claims corrected; historical audits stamped |

G3 items are **not** G1. Closing G3 in the repository does not make Atlas production-ready.
