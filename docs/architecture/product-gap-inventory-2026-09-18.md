# Atlas product gap inventory (2026-09-18)

**HEAD:** `71211dd` (at inventory start; see Git final state after this commit)  
**Rule:** TECHNICAL CLOSURE ≠ PRODUCT COMPLETION ≠ PRODUCTION PROOF ≠ COMMERCIAL VALIDATION.

This file is the product/readiness inventory. It does **not** reopen proven
local closure work. It does **not** claim production, customers, revenue, or
PMF.

Statuses: `PROVEN` · `IMPLEMENTED` · `PARTIAL` · `MISSING` ·
`BLOCKED_EXTERNAL` · `NOT_AVAILABLE_LOCALLY` · `PRODUCTION_NOT_PROVEN` ·
`PRODUCT_DECISION_REQUIRED`.

Priorities: `P0` launch/production · `P1` first commercial version ·
`P2` valuable roadmap · `P3` optional/future.

---

## Four states (do not collapse)

| State | Meaning now |
| --- | --- |
| Local technical closure | Closed for the proven Atlas code paths on this workstation |
| Product completion | Incomplete: memory UX, notifications, org, live billing, design-partner proof |
| Production proof | NOT PROVEN (AWS / private plane / live secrets) |
| Commercial validation | NOT CLAIMED (no customer/revenue/PMF evidence in-repo) |

---

## Feature matrix

| Feature | Category | Exists? | Evidence | Status | Missing work | External blocker | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| User identity (local + Supabase session) | Core | Yes | `apps/api/src/routes/auth.ts` | IMPLEMENTED | Live Supabase session on production | Production credentials | P0 |
| Registration / login / callback | Web | Yes | `apps/web/app/[locale]/auth/*` | IMPLEMENTED | Signed-in production E2E | Studio `.env.local` / live IdP | P0 |
| MFA (setup/verify/disable) | Security | Yes | `auth.ts` MFA routes + store | IMPLEMENTED | Live operator MFA on Control/Admin production | Production tokens | P1 |
| Auth rate limit | Security | Yes | `auth-rate-limit.ts`; Fastify rate-limit | IMPLEMENTED | Production limit tuning | none | P1 |
| Session list / revoke | Security | Yes | `auth-sessions.ts`; Settings UI | IMPLEMENTED | Browser E2E | none | P1 |
| Account deletion | Product | Yes | `DELETE /api/v1/auth/account`; Settings | IMPLEMENTED | Runtime proof of cascade (memory/projects) | none | P1 |
| Tenant isolation (`ownerId`) | Core | Yes | memory/evidence/project-access tests | PROVEN | Org model is not this | none | P0 |
| Project isolation / ownership | Core | Yes | `assertProjectOwnerOrClaim`; PSA tests | PROVEN | Unowned-project read is intentional G6 | none | P0 |
| Memory create | Core | Yes | `POST /api/v1/memory` owner-stamped | IMPLEMENTED | Dedicated product UX beyond Studio/PSA | none | P1 |
| Memory retrieve / search | Core | Yes | `GET /memory?query=` retrieve pipeline | IMPLEMENTED | Semantic search needs embeddings | Embedding provider (G4) | P1 |
| Memory list (owner-scoped) | Core | Yes | `scopeMemoriesToCaller` | PROVEN | Standalone `/memory` redirects to dashboard desk | none | P1 |
| Memory update / supersede | Core | Partial | `supersedeMatchingMemories` on create | PARTIAL | No first-class edit/correct API | none | P1 |
| Memory deletion | Core | No | No `DELETE /memory` | MISSING | Product delete/TTL | GAP-034 decision | P1 |
| Memory provenance / epistemic labels | Core | Yes | `epistemicState`, confidence, evidence excerpts | IMPLEMENTED | User-facing review UX is thin | none | P1 |
| Memory export (GDPR dump) | Core | No | Project `context-export` ≠ memory dump | MISSING | Export product | Product decision | P1 |
| Evidence store / retrieve | Core | Yes | `GET/POST /api/v1/evidence` owner filter | IMPLEMENTED | Live Postgres dual-write | Live DB | P0 |
| Truth / unverified distinction | Core | Yes | epistemic states; TruthPanel | IMPLEMENTED | Not a standalone “truth CMS” | none | P1 |
| Knowledge capture / search | Core | Yes | kernel knowledge ingest/search; knowledge routes | IMPLEMENTED | Live embeddings | Embedding provider | P2 |
| Bug/fix learning | Core | Yes | QA learn; OBSERVED SOLUTION memories | IMPLEMENTED | Not a public bug tracker | none | P2 |
| Cross-session continuity | Core | Yes | conversation threads; PSA persist | IMPLEMENTED | Production persistence | Live DB | P1 |
| Audit NDJSON chain | Core | Yes | `audit-log.ts`; apply audit proven | PROVEN | Production chain verify | Production Postgres | P0 |
| Data retention policy | Core | Plan field only | `plan-quota` `retentionDays` | PRODUCT_DECISION_REQUIRED | Policy + enforcement | GAP-034 | P2 |
| Fabric agent catalog (16) | Agents | Yes | `FABRIC_AGENT_CATALOG` | IMPLEMENTED | Catalog ≠ every agent operational | none | P1 |
| Agent plan / dispatch | Agents | Yes | kernel/agent-fabric routes | IMPLEMENTED | Live multi-agent E2E | none | P1 |
| Agent permissions / risk / approval | Agents | Yes | `authorizeEntityAction`; kill switch | PROVEN | none locally | none | P0 |
| Agent-scoped memory | Agents | Yes | `requestingAgentId` retrieve filter | IMPLEMENTED | omit-`agentId` policy open | GAP-026 | P1 |
| Agent lifecycle pause/quarantine/revoke | Agents | Yes | Control UI + API routes | IMPLEMENTED | Live CP→API hop | CP token on both processes | P1 |
| Agent-to-agent protocol (A2A) | Agents | No | Fabric catalog only | PRODUCT_DECISION_REQUIRED | Protocol product | GAP-031 | P3 |
| Agent retry / timeout / worker queue | Agents | Partial | `apps/worker` persist/retry | PARTIAL | Worker not a production scheduler | Production worker | P1 |
| CODE_ENGINEER patch proposal | Agents | Yes | Studio + `/code/patch` | PROVEN | none | none | P0 |
| PSA ownership / scope freeze | PSA | Yes | ensure + `assertPresentedProjectsOwned` | PROVEN | none | none | P0 |
| PSA memory isolation | PSA | Yes | project-scoped GET | PROVEN | none | none | P0 |
| PSA cannot approve/apply | PSA | Yes | explanation + no UI actions | PROVEN | none | none | P0 |
| PSA coordinate specialists | PSA | Yes | `coordinateSpecialists` API | IMPLEMENTED | Browser proof limited | none | P1 |
| Studio project picker | Studio | Yes | Studio combobox + projects API | PROVEN | none | none | P0 |
| Studio file tree / read | Studio | Yes | `GET /studio/tree`, `/studio/file` | IMPLEMENTED | Linked `workspaceRoot` required | Operator workspace | P1 |
| Studio human file write | Studio | Yes | `PUT /studio/file` + audit | IMPLEMENTED | Not the governed Patch path | none | P1 |
| Patch diff / approve / apply | Studio | Yes | Patch workflow; Apply proven | PROVEN | Signed-in Playwright still blocked by `replace-me` | Web env | P0 |
| Patch rollback | Studio | Yes | `POST /code/patches/:id/rollback` | IMPLEMENTED | Live rollback E2E | none | P1 |
| Studio checks (QA/health/truth/…) | Studio | Yes | Checks tab + panels | IMPLEMENTED | Several are local scans | none | P1 |
| Studio RTL he/en/ar | Studio | Yes | Live 200 this pass | PROVEN | none | none | P0 |
| Terminal / LSP / debugger / extensions | Studio | No | Explicit non-goal (GAP-043) | PRODUCT_DECISION_REQUIRED | Do not clone IDE | none | P3 |
| GitHub/local connections | Studio | Yes | per-owner PAT maps | IMPLEMENTED | GitHub App instance-wide | GAP-030 | P1 |
| Shared org Git | Studio | No | local folder + PAT | PRODUCT_DECISION_REQUIRED | Org Git model | GAP-037 | P2 |
| Web nav / dashboard / settings | Web | Yes | `AppShell` + routes | IMPLEMENTED | Many ops URLs redirect into Studio | none | P1 |
| Localization he/en/ar | Web | Yes | next-intl routing | PROVEN | Coverage quality not WCAG-certified | none | P1 |
| Accessibility (WCAG product cert) | Web | Partial | ARIA on Control/Web; axe e2e subset | PARTIAL | Formal a11y audit | none | P2 |
| Billing plan/usage UI | Commercial | Yes | `/billing/plan`; Settings billing | IMPLEMENTED | Live Stripe | `STRIPE_*` | P1 |
| Stripe checkout / webhook | Commercial | Yes | code path; stub without secrets | BLOCKED_EXTERNAL | Real Stripe | Stripe keys | P1 |
| Quotas (eval/audit/cloud) | Commercial | Yes | `plan-quota.ts` owner meters | IMPLEMENTED | Live subscription row | Live DB | P1 |
| Onboarding connect-repo / import | Commercial | Yes | `commercial.ts` | IMPLEMENTED | Design-partner live proof | Partner repo | P1 |
| Usage analytics | Commercial | Partial | admin `GET /analytics/usage` | PARTIAL | Not tenant self-serve BI | GAP-036 | P2 |
| Notifications / email | Product | No | automation-rules: no notifications | MISSING | Channel product | none | P1 |
| Organization / team RBAC | Product | Draft only | `DRAFT_multi_tenant_orgs.sql` | PRODUCT_DECISION_REQUIRED | ADR-012 | GAP-029 | P2 |
| SSO / SAML / SCIM | Product | No | Google/GitHub OAuth only | PRODUCT_DECISION_REQUIRED | Enterprise IdP | GAP-028 | P2 |
| Control live dashboard | Control | Yes | `:3100/dashboard` this pass | PROVEN | Canonical hop fail-closed without CP token | Token pairing | P0 |
| Control HMAC Civio observe | Control | Yes | signed 202 `executed:false` | PROVEN | Gemini not Control | Civio provider | P1 |
| Control cannot execute tools | Control | Yes | ADR-022; ingest NOT_IMPLEMENTED | PROVEN | none | none | P0 |
| Control approvals hop | Control | Yes | fail-closed if token unset | IMPLEMENTED | Live hop with matching tokens | Local/prod token | P1 |
| Admin `:3200` platform overview | Admin | Yes | live HTML this pass | IMPLEMENTED | Live counts need API session | none | P1 |
| HMAC application-preflight | Security | Yes | ALLOW/DENY live `:4000` | PROVEN | none | none | P0 |
| Kill switches | Security | Yes | API + Control UI | IMPLEMENTED | Live operator E2E with hop | CP hop | P1 |
| CORS allow-list | Security | Yes | `isAllowedWebOrigin` | IMPLEMENTED | Production origin list | Production domains | P0 |
| CSRF | Security | N/A cookie-session mixed | Bearer CP; cookie web | PARTIAL | Cookie CSRF review on Web | none | P1 |
| Production signing identity | Security | CLI fail-closed | `pnpm supply-chain:sign` REFUSE | PRODUCTION_NOT_PROVEN | Sigstore/cosign | GAP-024 | P0 |
| External pentest | Security | Scope only | `docs/security/pentest-readiness.md` | PRODUCTION_NOT_PROVEN | Vendor engagement | GAP-025 | P0 |
| Schema + migrations | Data | Yes | supabase/migrations (draft orgs excluded) | IMPLEMENTED | Apply on production PG | Production DB | P0 |
| Exclusive STARTED occupancy | Data | Yes | SQL + tests | IMPLEMENTED | Concurrent live PG proof | Production PG | P0 |
| Local JSON store fallback | Data | Yes | `osStore` | IMPLEMENTED | Not production persistence | Live DB | P0 |
| Local audit DR drill | DR | Yes | `pnpm dr:drill` | IMPLEMENTED | Offsite/cloud DR | GAP-023 | P0 |
| Offsite backup | DR | No dest | no object-store client | BLOCKED_EXTERNAL | Owner dest | GAP-023 | P0 |
| RPO/RTO | DR | Not claimed | drill note | PRODUCTION_NOT_PROVEN | Define + measure | Production | P0 |
| Health / liveness | Observability | Yes | `/health`; `/api/v1/health` | IMPLEMENTED | Production scrape | Production | P0 |
| Metrics / prometheus | Observability | Yes | `/api/v1/metrics/prometheus` | IMPLEMENTED | Alert routing | Monitoring vendor | P1 |
| Structured logs / request IDs | Observability | Yes | observability package; request timing | IMPLEMENTED | Central log drain | Production | P1 |
| Alerts | Observability | No product | no pager integration | MISSING | On-call | Vendor | P0 |
| HotelOS observe/preflight | Integration | Yes | process-live ALLOW | PROVEN | Atlas execute not in scope | ADR-022 | P1 |
| Civio observe/preflight | Integration | Yes | HMAC + Control ingest | PROVEN | Gemini complete answer | Provider key | P1 |
| CaseFlow connector | Integration | Yes | preflight + isolation tests | PROVEN | Full HTTP tenancy | CaseFlow env | P1 |
| CaseFlow HTTP tenant E2E | Integration | Blocked | health 503 missing env | BLOCKED_EXTERNAL | CaseFlow `.env` | CaseFlow keys | P1 |
| BrokerOS preflight | Integration | Yes | `assertAtlasPreflight` | PROVEN | App E2E | BrokerOS env | P1 |
| BrokerOS app | Integration | Blocked | no `.env.local` | BLOCKED_EXTERNAL | BrokerOS Supabase | BrokerOS keys | P1 |
| LexStudy app | Integration | Absent | no repo | NOT_AVAILABLE_LOCALLY | Sibling repo | Repo | P2 |
| Vantera app | Integration | Absent | no repo | NOT_AVAILABLE_LOCALLY | Sibling repo | Repo | P2 |
| Sibling execute | Integration | Forbidden | ADR-022 observe-only | PRODUCT_DECISION_REQUIRED | Owner amend or keep | GAP-027 | P2 |
| Private plane Ubuntu/Tailscale | Production | Artifacts | `docs/deployment/private-plane.md` | PRODUCTION_NOT_PROVEN | Reachable VM | AWS/Tailscale | P0 |
| Production deploy / TLS / rollback | Production | Docs/scripts | no live proof | PRODUCTION_NOT_PROVEN | Real deploy | AWS | P0 |
| Design-partner live proof | Commercial | Playbook | investor/partners pages | PRODUCT_DECISION_REQUIRED | Human partner run | GAP-056 | P1 |

---

## External blockers

| Blocker | Owner | Exact requirement | Why Atlas cannot complete it | Can agent prepare? | Next action | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CaseFlow HTTP tenancy | CaseFlow operator | `ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_KEY` in CaseFlow env | Atlas must not reuse Atlas Supabase keys | No fake keys | Provide CaseFlow’s own env; re-run Firm A/B HTTP | BLOCKED_EXTERNAL |
| BrokerOS application | BrokerOS operator | `apps/web/.env.local` + BrokerOS Supabase | Atlas credentials are a different tenant | No | Create BrokerOS env; start `:3010` | BLOCKED_EXTERNAL |
| Civio Gemini/provider | Civio operator | Real provider key (not dummy) | Fabricating 200 AI answers is false evidence | No | Supply key or accept observe-only | BLOCKED_EXTERNAL |
| LexStudy | Founder | Sibling repository | Not on disk | No placeholder app | Clone/verify from its source | NOT_AVAILABLE_LOCALLY |
| Vantera | Founder | Sibling repository | Not on disk | No | Clone/verify from its source | NOT_AVAILABLE_LOCALLY |
| AWS / private plane | Founder | Account access, VM, Tailscale | No production traffic possible | Scripts exist | Restore AWS; follow `private-plane.md` | PRODUCTION_NOT_PROVEN |
| Live Postgres/Supabase (production) | Founder | Production `DATABASE_URL` / `SUPABASE_*` | Local JSON ≠ production persistence | Migrations exist | Provision and migrate | PRODUCTION_NOT_PROVEN |
| Studio production env | Founder | Real `apps/web/.env.local` (not `replace-me`) | Signed-in browser E2E blocked | No commit secrets | Operator env | BLOCKED_EXTERNAL |
| Stripe | Founder | `STRIPE_SECRET_KEY` + webhook secret | Checkout stays stub | Code ready | Configure Stripe | BLOCKED_EXTERNAL |
| Embedding provider | Founder | Live embedding HTTP | Lexical-hash fallback only | Code ready | Configure provider | BLOCKED_EXTERNAL |
| Offsite DR dest | Founder | `ATLAS_OFFSITE_BACKUP_DIR` or authorized bucket | No in-repo object-store client | Local drill only | Choose dest; run drill | BLOCKED_EXTERNAL |
| Signing identity | Founder | Sigstore/cosign identity | CLI refuses unsigned | SBOM ready | Issue identity | PRODUCTION_NOT_PROVEN |
| External pentest | Founder + vendor | Engagement + reachable env | Scope ≠ pentest | Scope package ready | Hire vendor | PRODUCTION_NOT_PROVEN |
| ADR-022 sibling execute | Founder | Written amendment or keep observe-only | Implementing execute invents a contract | No | Decide | PRODUCT_DECISION_REQUIRED |

---

## Production readiness gate

All rows remain **PRODUCTION_NOT_PROVEN** unless noted as local-only.

| Item | Local code? | Production evidence | Status |
| --- | --- | --- | --- |
| Infrastructure / AWS | Docs | None (account blocked) | PRODUCTION_NOT_PROVEN |
| Deployment / rollback | Scripts | None | PRODUCTION_NOT_PROVEN |
| TLS / reverse proxy / Tailscale | Docs | None | PRODUCTION_NOT_PROVEN |
| Secrets / env | Local `.env` uncommitted | Production secrets not verified | PRODUCTION_NOT_PROVEN |
| Database + migrations | Repo migrations | Not applied on production PG | PRODUCTION_NOT_PROVEN |
| Health checks | `/health` | Not scraped in production | PRODUCTION_NOT_PROVEN |
| Monitoring / alerting | Metrics endpoint | No production alerts | PRODUCTION_NOT_PROVEN |
| Backup / restore / DR | Local NDJSON drill | Offsite not verified | PRODUCTION_NOT_PROVEN |
| Signing identity | Fail-closed CLI | Unset | PRODUCTION_NOT_PROVEN |
| Pentest | Scope package | None | PRODUCTION_NOT_PROVEN |
| Production E2E / smoke | Local proofs | None | PRODUCTION_NOT_PROVEN |
| Incident response | Docs partial | Unproven | PRODUCTION_NOT_PROVEN |

---

## Integration matrix

| Application | Atlas connection | Authentication | Authorization | Audit | Memory | Runtime E2E | Current blocker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HotelOS | Preflight HMAC + gateway observe | HMAC | Atlas ALLOW/DENY; HITL stays in HotelOS | Atlas audit + HotelOS sqlite | Atlas does not host HotelOS domain memory | PROCESS-LIVE PROVEN | ADR-022 no Atlas execute |
| Civio | Preflight + Control HMAC ingest | HMAC | Observe-only; `executed:false` | Atlas + Control in-memory | Not Civio legal corpus | Process-live PROVEN; AI answer BLOCKED | Gemini/provider key |
| CaseFlow | Preflight HMAC | HMAC | Isolation unit tests; foreign 403 | Atlas preflight audit | Not CaseFlow case data | Connector PROVEN; HTTP E2E BLOCKED | CaseFlow ENCRYPTION_KEY / SUPABASE_* |
| BrokerOS | Preflight | HMAC | Atlas preflight | Atlas audit | Not BrokerOS data | Preflight PROVEN; app BLOCKED | `.env.local` / Supabase |
| LexStudy | HMAC contract only | HMAC if called | n/a | n/a | n/a | NOT_AVAILABLE_LOCALLY | Sibling repo |
| Vantera | HMAC contract only | HMAC if called | n/a | n/a | n/a | NOT_AVAILABLE_LOCALLY | Sibling repo |

Atlas does not execute sibling tools. Sibling HITL remains in the sibling.

---

## Master gap table

| ID | Area | Gap | Status | Evidence | Can Atlas agent fix it? | External dependency | Priority | Next action |
| -- | ---- | --- | ------ | -------- | ----------------------- | ------------------- | -------- | ----------- |
| G-P0-01 | Production | AWS/private plane unverified | PRODUCTION_NOT_PROVEN | `private-plane.md`; no VM proof | After access, yes deploy | AWS/Tailscale | P0 | Restore AWS access |
| G-P0-02 | Production | Production Postgres/migrations | PRODUCTION_NOT_PROVEN | Local `:54322` ≠ production | After credentials, yes | Production DB | P0 | Provision + migrate |
| G-P0-03 | Security | External pentest | PRODUCTION_NOT_PROVEN | Scope READY | No (vendor) | Security vendor | P0 | Engage vendor |
| G-P0-04 | Security | Signing identity | PRODUCTION_NOT_PROVEN | Sign CLI REFUSE | No | Sigstore/cosign | P0 | Issue identity |
| G-P0-05 | DR | Offsite backup/restore | PRODUCTION_NOT_PROVEN | Local drill only | After dest, run drill | Backup dest | P0 | Set dest |
| G-P0-06 | Ops | Production monitoring/alerts | MISSING as product | Metrics endpoint only | Partial (wire drain) | Observability vendor | P0 | Choose stack |
| G-P0-07 | Web | Production Studio secrets | BLOCKED_EXTERNAL | `.env.local` replace-me | No commit secrets | Operator env | P0 | Operator fills env |
| G-P1-01 | CaseFlow | Full HTTP tenant E2E | BLOCKED_EXTERNAL | Health 503 missing env | No | CaseFlow env | P1 | CaseFlow keys |
| G-P1-02 | BrokerOS | Full app E2E | BLOCKED_EXTERNAL | No `.env.local` | No | BrokerOS env | P1 | BrokerOS keys |
| G-P1-03 | Civio | Complete AI response | BLOCKED_EXTERNAL | Prior Gemini 502 | No | Provider | P1 | Real key or accept observe-only |
| G-P1-04 | Product | Memory correct/export UX | CLOSED locally (DELETE/TTL remains a product decision) | Correct + owner-scoped export verified | No | Retention decision for DELETE only | P1 | See remaining-external-dependencies.md |
| G-P1-05 | Product | Notifications | CLOSED locally (in-app only) | Inbox GET/dismiss verified; email/SMS out of scope | No | Email/SMS vendor only if later added | P1 | See remaining-external-dependencies.md |
| G-P1-06 | Commercial | Live Stripe | BLOCKED | Stub without secrets | After keys, verify webhook | `STRIPE_SECRET_KEY` + webhook signing secret | P1 | User supplies Stripe secrets |
| G-P1-07 | Commercial | Design-partner live proof | BLOCKED | Playbook only | Support the run | Real human partner session | P1 | User runs one partner audit |
| G-P1-08 | Control | Canonical API hop | BLOCKED | Fail-closed without matching token | After pairing, live hop | Same `ATLAS_CONTROL_PLANE_TOKEN` on API + Control | P1 | User/deploy sets matching token |
| G-P1-09 | Data | Live embeddings | BLOCKED | Lexical-hash fallback | After provider | Embedding HTTP provider + credentials | P1 | User configures provider |
| G-P2-01 | Product | Org/team RBAC | PRODUCT_DECISION_REQUIRED | Draft SQL | After ADR | none | P2 | Keep ownerId or amend |
| G-P2-02 | Product | SSO/SAML/SCIM | PRODUCT_DECISION_REQUIRED | OAuth only | After decision | IdP | P2 | Decide enterprise identity |
| G-P2-03 | Architecture | Sibling execute | PRODUCT_DECISION_REQUIRED | ADR-022 | After written amendment | none | P2 | Keep observe-only or amend |
| G-P2-04 | Apps | LexStudy | NOT_AVAILABLE_LOCALLY | No dir | No | Repo | P2 | Provide repo |
| G-P2-05 | Apps | Vantera | NOT_AVAILABLE_LOCALLY | No dir | No | Repo | P2 | Provide repo |
| G-P3-01 | Studio | Terminal/LSP/debugger | PRODUCT_DECISION_REQUIRED | Non-goal GAP-043 | Do not implement as closure | none | P3 | Leave as roadmap |
| G-P3-02 | Agents | A2A / enterprise agent ID | PRODUCT_DECISION_REQUIRED | Catalog only | After scope | none | P3 | Out of current product |
| G-LOCAL-01 | Code G1 | Confirmed open code defect | none found | Landscape G1=0; this pass no new G1 | n/a | n/a | — | Do not hunt hypothetically |

---

## Milestone plan

### 0–3 months

| Objective | Dependency | Owner | Evidence | Effort | Blocker |
| --- | --- | --- | --- | --- | --- |
| Restore production access + private plane | AWS/Tailscale | Founder + agent | Reachable VM, TLS, health | Weeks | AWS account |
| Production Postgres + migrations | DB credentials | Founder + agent | Health DB live; occupancy proof | Days–weeks | Credentials |
| Operator env (Studio, CP token hop, HMAC secrets) | Secrets not in Git | Founder | Signed-in Studio + Control hop | Days | Operator |
| Keep observe-only siblings unless ADR-022 amended | Decision | Founder | Written keep/amend | Hours | Decision |
| One design-partner or self-hosted commercial path | Partner or self | Founder | Documented run | Weeks | Partner |

### 3–6 months

| Objective | Dependency | Owner | Evidence | Effort | Blocker |
| --- | --- | --- | --- | --- | --- |
| External pentest + fix cycle | Env + vendor | Founder + vendor | Report | Months | Vendor |
| Signing identity + release gate | Cosign | Founder | Signed artifact | Weeks | Identity |
| Offsite DR restore drill | Dest | Founder + agent | Restore log | Weeks | Dest |
| Memory product UX (search/correct/delete per policy) | Retention decision | Agent after decision | Browser proof | Weeks | GAP-034 |
| Live Stripe if commercial billing is in-scope | Stripe | Founder + agent | Checkout+webhook | Weeks | Keys |
| Sibling HTTP E2E for apps that are launch-critical | Their env | Sibling owners | Firm A/B / app login | Weeks | Their keys |

### 6–12 months

| Objective | Dependency | Owner | Evidence | Effort | Blocker |
| --- | --- | --- | --- | --- | --- |
| Monitoring/alerting/on-call | Vendor | Founder | Alert fire drill | Months | Stack |
| Optional org/SSO if selling teams | G5 | Founder then agent | Authz tests | Months | Decision |
| Additional connected apps (LexStudy/Vantera) if in portfolio | Repos | Founder | Observe/preflight | Months | Repos |
| Semantic memory if retrieval quality is a sales claim | Embeddings | Founder | Retrieval evals | Months | Provider |

### 12–18 months

| Objective | Dependency | Owner | Evidence | Effort | Blocker |
| --- | --- | --- | --- | --- | --- |
| Repeatable production operations (rollback, DR, IR) | Prior ops | Founder | Runbooks used in anger | Months | Production |
| Compliance roadmap only if selling regulated | G5 | Founder | Scoped controls | Months | Decision |
| Sibling execute only if ADR-022 amended | Amendment | Founder then agent | One named action | Months | Decision |
| Next financing evidence pack | Traction | Founder | Customers/usage — not invented here | — | Commercial |

No revenue or valuation numbers are claimed.

---

## What $600K should fund (if raised)

Not a forecast. Allocation of engineering capacity toward remaining **real** work:

1. Production plane (AWS, Tailscale, Postgres, TLS, deploy/rollback) — largest share.
2. External pentest + signing + offsite DR.
3. One commercial proof (design partner or paid self-serve) including live billing if that is the offer.
4. Product UX that makes proven APIs usable (memory review, notifications, onboarding).
5. **Not** IDE clone, **not** absorbing sibling apps, **not** org/SSO unless the offer is teams.

---

## Do not implement as closure

- Terminal, LSP, debugger, extensions
- Org RBAC / SAML without written G5
- Atlas executing sibling tools without ADR-022 amendment
- Fake CaseFlow/BrokerOS/Gemini/AWS evidence
- Merging Control into Web
