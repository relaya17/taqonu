# ATLAS PRODUCTION VERIFICATION REPORT — 2026-09-24

Produced under the ATLAS Master Production Verification Execution Plan.
Mode: EXECUTE / VERIFY ONLY. No implementation changes were made.

---

## 1. Run Identity

| Field | Value |
|---|---|
| Run ID | `RUN-2026-09-24-PROD-01` |
| Evidence bundle | `production-verification/RUN-2026-09-24-PROD-01/` |
| Mode | EXECUTE / VERIFY ONLY |
| Operator credentials held | none for production API, none for production Control Plane |
| Mutating calls made | none |
| Implementation changes made | none |

---

## 2. Production Environment

Four live Vercel surfaces were identified and probed read-only over HTTPS with no credentials
supplied. Raw capture: `00-baseline/service-health.txt` (captured 2026-09-24T08:08:02Z).

| Surface | Host | Observed |
|---|---|---|
| Web | `taqonu-web.vercel.app` | `/` → 307 → `/he/welcome`; `/en/projects` → 200 (Next.js App Router HTML) |
| API | `taqonu-api.vercel.app` | 503 `CONFIG_ERROR` on every route probed |
| Control Plane | `taqonu-control-plane.vercel.app` | `/api/v1/status` → 200; all other probed endpoints → 401 |
| Admin | `taqonu-admin.vercel.app` | 200, static Atlas Admin shell |

Correction to a prior working assumption: an earlier analysis concluded that no production
environment was reachable. Direct probing disproved that. Three of the four surfaces respond
normally; the API does not.

### 2.1 Production API state

Every route on `taqonu-api.vercel.app` returns HTTP 503 with body (raw, unedited, preserved at
`04-evidence/api-503-config-error-raw.json`):

```
{"error":{"code":"CONFIG_ERROR","message":"Failed to load native module: pty.node, checked:
build/Release, build/Debug, prebuilds/linux-x64: Error: Cannot find module
'./prebuilds/linux-x64//pty.node'\nRequire stack:\n- /var/task/apps/api/vercel-bundle.cjs\n-
/var/task/apps/api/api/index.js","hint": ... }}
```

Established, without modifying anything:

- `apps/api/vercel.json` rewrites `/(.*)` to the single function entry `/api`, so the failure
  is not route-specific — it precedes routing.
- `apps/api/api/index.js:34-52` wraps boot in try/catch and, on any boot error, returns a fixed
  503 `CONFIG_ERROR` handler for all requests.
- The `hint` field in that response ("Set DATABASE_URL, SUPABASE_URL, …") is static boilerplate
  emitted for *any* boot failure (`apps/api/api/index.js:22`). It is **misleading here**: the
  actual cause is in `message`, not missing environment variables.
- Root cause: `apps/api/scripts/bundle-vercel.mjs:30` declares
  `external: ["sharp", "pg-native", "@biomejs/biome", "fsevents"]`. `node-pty` is not
  externalised, so it is inlined by esbuild and its `linux-x64` native binding
  (`pty.node`) is never shipped to the serverless bundle.

Per plan §1.2 this was **reported, not fixed**. No file in `apps/api/` was modified.

### 2.2 Production Control Plane state

Consistent with the ADR-021 fail-closed design in `apps/control-plane/src/control-plane-auth.ts`:
public liveness only, bearer token for everything else.

- `GET /api/v1/status` → 200 (`04-evidence/control-plane-status-raw.json`)
- Eleven further endpoints → 401 `Control Plane authentication required`
  (`02-observations/control-plane-readonly-probes.txt`)

Security decision recorded: the local **development** `ATLAS_CONTROL_PLANE_TOKEN` was
deliberately **not** presented to the production Control Plane. Presenting a development
secret to a production access control is a credential-hygiene violation, and a token that
happened to be accepted would itself be a finding of the wrong kind.

No mutating Control Plane endpoint was called: not `POST /api/v1/approvals/:id/decide`, not
`POST /api/v1/kill-switches/:category`, not `POST /api/v1/connectors/civio/events`, not
`POST /api/v1/gateway/events`, not `POST /api/v1/gateway/ops`, not
`POST /api/v1/agents/:id/control`.

---

## 3. Commit / Version

| Field | Value |
|---|---|
| Local HEAD | `261c360d8fd7dc7e88e4fc8f9143d8225661a46c` |
| Branch | `main`, `origin/main` == HEAD |
| Working tree | clean except the untracked `production-verification/` bundle created by this run |
| Deployed production build commit | **NOT ESTABLISHABLE** |

Raw capture: `00-baseline/git-commit.txt`, `00-baseline/git-status.txt`,
`00-baseline/production-version.txt`.

No deployment-to-commit binding exists on any of the four production surfaces. Checked and not
found: a `/version` or build-info endpoint on any host; `VERCEL_GIT_COMMIT_SHA` (or equivalent)
surfaced in any response; a deployment or commit response header. The Control Plane
`version: "0.1.0"` is a hard-coded literal in `apps/control-plane/src/routes/api.ts:288-295`
and identifies the service, not the build. `X-Vercel-Id` is a per-request trace id, not build
identity.

**Consequence.** Even a perfectly healthy production surface cannot be attributed to commit
`261c360` on production evidence alone. This independently blocks `PRODUCTION VERIFIED` for
every R-item in this run, separately from the API outage. It is recorded as a verification
gap, not worked around.

---

## 4. Execution Timestamp

| Event | UTC |
|---|---|
| Run started | 2026-09-24T07:57:21Z |
| Baseline captured | 2026-09-24T08:07:44Z |
| Service health sweep | 2026-09-24T08:08:02Z |
| Deployment identity check | 2026-09-24T08:08:10Z |
| Run concluded | 2026-09-24T08:16:40Z |

Local offset at capture: `+03:00`. Baseline file: `00-baseline/timestamp.txt` (not edited
after capture, per plan §7).

---

## 5. R-item Matrix

| R-ID | Status | Execution Time | Evidence | Notes |
|---|---|---|---|---|
| R-001 Production Baseline | **FAILED** | 07:57:21Z–08:08:10Z | `00-baseline/*`, `04-evidence/api-503-config-error-raw.json`, `05-results/R-001.md` | Production API returns 503 on every route; explicit 200 contract for `/health` violated. Root cause: `node-pty` not externalised in `bundle-vercel.mjs:30`. |
| R-002 Agent Identity | BLOCKED | 07:57:21Z–08:08:10Z | `02-observations/*`, `05-results/R-002.md` | API 503 (→R-001) + no production Control Plane token. |
| R-003 Supervision | BLOCKED | 07:57:21Z–08:08:10Z | `02-observations/*`, `05-results/R-003.md` | `/api/v1/supervision` → 401. |
| R-004 Approval Binding | BLOCKED | 07:57:21Z–08:08:10Z | `02-observations/*`, `05-results/R-004.md` | Approval decision endpoint deliberately not called (§1.2). |
| R-005 Dispatch Guard | BLOCKED | 07:57:21Z–08:08:10Z | `02-observations/*`, `05-results/R-005.md` | Guard never reached; no policy weakened to force execution. |
| R-006 Risk Policy | BLOCKED | 07:57:21Z–08:08:10Z | `02-observations/*`, `05-results/R-006.md` | `/api/v1/policies` → 401; no policy modified. |
| R-007 Kill-Switch Enforcement | BLOCKED | 07:57:21Z–08:08:10Z | `02-observations/*`, `05-results/R-007.md` | Kill-switch deliberately not engaged; no owner mandate. |
| R-008 Universal Audit Log | BLOCKED | 07:57:21Z–08:08:10Z | `03-audit/README-EMPTY.txt`, `05-results/R-008.md` | No production action to audit; audit endpoints → 401. Local audit chain not substituted. |
| R-009 Evidence Chain | BLOCKED | 07:57:21Z–08:08:10Z | `03-audit/README-EMPTY.txt`, `05-results/R-009.md` | No chain link traversable; `/audit/verify` → 401. |
| R-010 Epistemic State | BLOCKED | 07:57:21Z–08:08:10Z | `02-observations/*`, `05-results/R-010.md` | No production result existed to classify. |
| R-011 Memory Isolation Regression | BLOCKED | 07:57:21Z–08:08:10Z | `00-baseline/service-health.txt`, `05-results/R-011.md` | No session possible; no real user data touched. |
| R-012 Telemetry Attribution | BLOCKED | 07:57:21Z–08:08:10Z | `02-observations/*`, `05-results/R-012.md` | Telemetry POSTs deliberately not sent; would pollute production data. |
| R-013 Apply → Verify → Rollback | BLOCKED | 07:57:21Z–08:08:10Z | `02-observations/*`, `05-results/R-013.md` | No change applied to production; no mandate. |
| R-014 Failure Path | BLOCKED | 07:57:21Z–08:08:10Z | `04-evidence/api-503-config-error-raw.json`, `05-results/R-014.md` | The API 503 is a boot failure, **not** the controlled application failure; explicitly not substituted. |
| R-015 Production Persistence / Recovery | BLOCKED | 07:57:21Z–08:08:10Z | `00-baseline/production-version.txt`, `05-results/R-015.md` | No authorised restart/redeploy; §R-015 and §10 direct BLOCKED. |
| R-016 Golden Production Verification Run | BLOCKED | 07:57:21Z–08:08:10Z | `06-artifacts/README-EMPTY.txt`, `05-results/R-016.md` | Chain could not start; GATES 0–3 not satisfied. |

Per plan §8, no `BLOCKED` item was converted to `FAILED`. The single production defect is
recorded once, at R-001, and cross-referenced by the dependent items rather than re-counted
as fifteen separate failures.

---

## 6. Verified Items

**None.**

Zero R-items reached `PRODUCTION VERIFIED` in this run.

Two independent conditions each prevent that status for every item:

1. The production API is down on all routes, so no governed workflow could be executed.
2. No deployment-to-commit binding exists, so even a healthy surface cannot be attributed to
   an audited build.

### 6.1 Supplementary production observations (not R-items, not counted)

These are genuine production observations recorded for completeness. They are **not** claimed
as R-item passes.

- **Legacy redirect layer — executed in production.** All four redirects configured in
  `apps/web/next.config.ts` were exercised against `taqonu-web.vercel.app` and each returned
  307 with the correct `Location`, with 200 at the destination:
  `/en/state → /en/projects`, `/en/chat → /en/workbench`, `/en/agent → /en/agents`,
  `/en/proof → /en/readiness`. Evidence:
  `01-execution/web-legacy-redirects-production.txt`. This upgrades a previously local-only
  observation to production-observed, but it corresponds to no R-item.
- **Control Plane access control is engaged.** One public liveness endpoint returned 200 and
  eleven governance endpoints returned 401. This evidences that the fail-closed boundary is
  active in production. It does **not** evidence that any governed workflow behind that
  boundary executes correctly.

---

## 7. Executed but Not Verified

**None.**

No R-item reached the state of having been executed in production with insufficient evidence
captured. Nothing was executed.

---

## 8. Blocked Items

R-002, R-003, R-004, R-005, R-006, R-007, R-008, R-009, R-010, R-011, R-012, R-013, R-014,
R-015, R-016 — fifteen items.

Each individual result file records `external blocker: / required condition: /
attempted action: / evidence:` per plan §6 Case A.

### 8.1 Common blockers

**Blocker A — Production API unavailable.**
Every route on `taqonu-api.vercel.app` returns 503 at boot. This is an Atlas deployment-artifact
defect, not a provider outage. Recorded once as FAILED at R-001.

**Blocker B — No production Control Plane credential.**
All governance endpoints require `ATLAS_CONTROL_PLANE_TOKEN`. This operator holds none, and the
local development token was deliberately not presented to production.

**Blocker C — No deployment-to-commit binding.**
Nothing observable in production identifies the deployed build.

**Blocker D — No production change mandate.**
R-007 (engage a kill-switch), R-012 (emit telemetry into production), R-013 (apply a production
change) and R-015 (restart production) each additionally require an explicit owner mandate with
an agreed blast radius and rollback window. None was granted for this run, so per §1.2 and §10
these operations were not improvised.

### 8.2 Conditions required to unblock

1. A production API deployment that boots — either externalise `node-pty` in
   `apps/api/scripts/bundle-vercel.mjs` or ship the `linux-x64` `pty.node` binding.
   *(Stated as the required condition. Not performed: it is an implementation change and lies
   outside EXECUTE / VERIFY ONLY scope.)*
2. A production Control Plane operator or owner token, issued through the normal secret
   distribution path.
3. A deployment-to-commit binding exposed by production (build-info endpoint or commit header).
4. An owner mandate covering the four mutating scenarios above.
5. Two disposable non-customer test identities in production for R-011.

---

## 9. Failed Items

**R-001 — Production Baseline.**

Classified `FAILED` under plan §6 Case C (contract violation), not `BLOCKED`, for two reasons:

1. **An explicit contract is violated.** `GET /health` is declared a public route returning
   200: `apps/api/src/routes/health.ts:35`, asserted in `apps/api/src/routes/health.test.ts:27`
   and `apps/api/src/private-by-default.test.ts:22`, and whitelisted by
   `apps/api/src/middleware/public-routes.test.ts:6`. Production returns 503.
2. **The cause is an Atlas artifact, not an external condition.** The failing bundle is
   produced by `apps/api/scripts/bundle-vercel.mjs`. Classifying this `BLOCKED` would
   misattribute an Atlas deployment defect to an external cause, which plan §6 Case A
   explicitly guards against in the opposite direction.

No other item is classified `FAILED`. The same single defect is not re-counted fifteen times.

---

## 10. Evidence Index

Bundle root: `production-verification/RUN-2026-09-24-PROD-01/`

```
00-baseline/
  git-commit.txt                          HEAD 261c360…, branch, origin parity, log -3
  git-status.txt                          working tree state at run start
  timestamp.txt                           run id, start/baseline times, local offset
  service-health.txt                      six-URL sweep: status lines + first 300B of each body
  production-version.txt                  deployment→commit binding: NOT ESTABLISHABLE, with
                                          everything checked and not found

01-execution/
  web-legacy-redirects-production.txt     four production redirect executions (307 + 200)

02-observations/
  control-plane-readonly-probes.txt       twelve endpoint probes: 1×200 public, 11×401

03-audit/
  README-EMPTY.txt                        empty by observation; why no audit record exists

04-evidence/
  api-503-config-error-raw.json           470 B, raw, unedited
  control-plane-status-raw.json           121 B, raw, unedited

05-results/
  R-001.md … R-016.md                     sixteen result files in the mandated field order

06-artifacts/
  README-EMPTY.txt                        empty by observation; no scenario executed
```

**Evidence integrity (plan §7).** No raw capture was edited after collection. The two
`04-evidence/*.json` files are the unmodified response bodies. `03-audit/` and `06-artifacts/`
are empty because nothing was retrieved or produced, and each carries a note stating why —
they are empty by observation, not by omission. No locally generated data was placed in any
directory to stand in for production evidence; in particular `.atlas/audit/audit.ndjson` was
neither modified nor copied into the bundle.

---

## 11. Golden E2E Result

**BLOCKED.**

The chain `User / Request → Agent Identity → Policy → Risk → Supervision → Approval →
Dispatch Guard → Action → Event → Audit → Evidence Reference` was not entered. Its first stage
after the request is reached through the API, which returns 503 before routing.

Per plan §4, GATE 4 runs only after GATES 0–3. GATE 0 is FAILED and GATES 1–3 are entirely
BLOCKED, so no prerequisite stage has production evidence behind it. Executing GATE 4 anyway
would have produced a second observation of the same 503, not a verification.

Detail: `05-results/R-016.md`.

---

## 12. Remaining Verification Work

### 12.1 IMPLEMENTED vs PRODUCTION VERIFIED

These are distinct and this report does not conflate them. Every R-item in scope corresponds
to code that exists in the repository at `261c360`. Per plan §1.3, that is **not** verification:
"the code exists", "the test passed", "the implementation appears correct" are insufficient by
themselves.

| | Count |
|---|---|
| R-items whose implementation exists in the repository | 16 |
| R-items PRODUCTION VERIFIED | **0** |

No item in this report is claimed as Production Verified on the strength of prior
implementation, prior tests, or source inspection.

### 12.2 Work remaining, in order

1. **Restore the production API.** Externalise `node-pty` in
   `apps/api/scripts/bundle-vercel.mjs`, or ship the `linux-x64` `pty.node` binding.
   Separately, consider whether the static `hint` in `apps/api/api/index.js:22` should remain
   attached to non-configuration boot failures — it currently misdirects diagnosis. Both are
   implementation changes and were **not** made in this run.
2. **Establish a deployment-to-commit binding.** Without it, no future run can produce
   `PRODUCTION VERIFIED` either, regardless of API health.
3. **Provision a production Control Plane credential** for the verification operator.
4. **Obtain an owner mandate** for the four mutating scenarios (R-007, R-012, R-013, R-015),
   with blast radius and rollback window agreed in advance.
5. **Provision disposable test identities** for R-011 so isolation can be probed without
   touching real customer data.
6. **Re-run the full plan from GATE 0.** R-001 must pass before GATE 1 is attempted; no item
   below GATE 0 carries forward from this run.

### 12.3 Scope statement

No implementation file was created, modified or deleted during this run. No production state
was mutated. No security control was bypassed or weakened. No commit, push or deploy was
performed. The only files written are the evidence bundle and this report.
