# ADR-026 — Studio native extensions (official catalog, no third-party code)

**Status:** Accepted
**Date:** 2026-10-03
**Product:** ArletOS (Web + Studio)
**Decision:** Arlet, 2026-10-03 — closes open question **Q11-6 / AD-5**
("extension system or closed workbench?") in
`docs/architecture/ARLETOS_MASTER_PROBLEM_REGISTER.md`.
**Supersedes:** the "deliberate non-goal" flags in
`apps/api/src/services/studio-extensions.ts` (`STUDIO_EXTENSION_CONTRACT`)
and `apps/api/src/services/studio-execution.ts`
(`STUDIO_EXECUTION_CONTRACT.extensionsHostProductGoal`), and the
"extensions" item of GAP-043's non-goal list.
**Does not change:** Control, its documents or its plans (ADR-025 boundary).
`CONTROL_10_OF_10_MASTER_PLAN.md` ("do not clone VS Code / Cursor into Studio
for benchmark parity") stays true: this ADR does not make Studio a VS Code
clone and does not host VS Code extensions.
**Relates to:** ADR-021 (trust planes), ADR-023 (single live approval
authority), ADR-025 (ArletOS ↔ Control ↔ Atlas boundary).

## 1. Decision

Studio gets a **native ArletOS extension system**. An extension is a
**declarative manifest** that connects capabilities ArletOS already has
(Git, tests, cloud, security, observer, engineering runs…) to the Studio
workbench: an activity-bar icon, a side-bar panel and commands. It is not a
way to run new code.

Two kinds, and only two, exist in this phase:

| Kind | Examples | Install / uninstall | Enable / disable | Permissions |
|---|---|---|---|---|
| **Built-in** | Git, Tests | Ship with ArletOS; cannot be uninstalled | Yes, per project | Explicit grant |
| **Official** | Cloud & deploy, Security, Observer, Engineering runs | From the official catalog; can be uninstalled | Yes, per project | Explicit grant |

**Third-party extensions do not exist in this phase.** A later phase
(a separate, not yet approved third-party phase) needs its own ADR covering an API contract,
isolation (a sandboxed browser frame that talks to Studio only through a host
bridge), source verification and signing, and permission enforcement. Until
that ADR is accepted the catalog accepts no manifest that is not compiled into
the API.

## 2. Rules

1. **No extension code runs on the server.** Manifests are data compiled into
   the API (`STUDIO_BUILTIN_EXTENSIONS` / official catalog). There is no upload,
   no user-provided JavaScript and no VSIX/VS Code compatibility layer.
2. **Installing grants nothing.** Every permission an extension declares is
   granted (and revoked) explicitly by the user, one by one, and each change is
   audited. An update that adds a permission leaves it pending; capabilities
   that need it stay off until it is granted.
3. **Unknown permissions and unknown extensions fail closed.**
4. **Server-side enforcement.** Requests made on behalf of an extension carry
   `x-arletos-extension: <id>`. The API then requires that the extension is
   known, compatible, installed for the user (built-ins always are), enabled
   for the project, that the route is one the manifest declares, and that the
   permission the manifest binds to that route is granted. Otherwise → 403 with
   a reason. Core Studio surfaces (Checks, menus) keep working without
   extensions; the header only scopes what an extension may do.
5. **Real capabilities only.** A manifest may only reference routes and
   panels that exist. Planned capabilities (MCP connections, database queries,
   live cloud logs, debugging) are **not** part of this decision and need their
   own definition and approval before any manifest mentions them.
6. **Every lifecycle change is audited** (`studio.extension.*`): install,
   uninstall, update, permission granted/revoked, enabled/disabled, order
   changed, verification run.

## 3. State and scope (durable)

| Scope | What is stored |
|---|---|
| **User** | Installed extensions and their installed version; permissions granted per extension |
| **Project** | Which installed extensions are enabled; activity-bar icon order; per-project view state; last verification result |

State lives in the Atlas OS store (`osStore`), which persists to the durable
cloud store (Supabase `atlas_os_store`) on serverless deploys — it survives
sign-in, reloads and instances. The previous process-local enablement map is
removed.

## 4. Catalog states shown to the user

- **Registered** — listed in the official catalog.
- **Installed & enabled** — connected to Studio in this project (icon, panel, commands).
- **Verified** — the verification check passed: the extension's prerequisites
  (for example a linked workspace folder or a Git repository) hold in this
  project.

**Health Check contract — implemented (2026-10-03).** Verification now runs a
generic, per-capability health engine
(`apps/api/src/services/studio-extension-health.ts`), not just the
local/project prerequisite checks described above. The engine is documented
here because it is the mechanism behind "Verified"; it remains **informational
only** — it never grants, revokes, installs, enables, disables or otherwise
changes extension state, and the extension gate
(`middleware/studio-extension-gate.ts`) never imports it.

- **Dependencies are data.** A manifest declares, per capability (plus
  manifest-level dependencies shared by all capabilities), which dependency
  *kinds* it needs: `project.workspace`, `project.git-repo`,
  `studio.compatible`, `route.registered`, `service.approval-store`,
  `service.durable-store`, `credential.present`. Probes are server-owned,
  read-only and keyed by kind — the engine itself holds no extension-specific
  branching. A kind with no registered probe is `NOT_CHECKED` /
  `UNKNOWN_DEPENDENCY`, never `HEALTHY`.
- **Dependency states:** `OK`, `MISSING`, `NOT_CONFIGURED`, `UNREACHABLE`,
  `ERROR`, `TIMEOUT`, `RATE_LIMITED`, `NOT_CHECKED`. HTTP `502`/`503`/`504`
  classify as `UNREACHABLE` (an availability condition); `429` classifies as
  `RATE_LIMITED` (not an outage); other failures (`400`, `500`,
  decode/parse errors, invalid probe output) classify as `ERROR`.
- **Capability states:** `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, `NOT_CHECKED`,
  derived from a capability's dependency results in fixed rule order: a
  confirmed failure among required dependencies (`MISSING`, `NOT_CONFIGURED`,
  `UNREACHABLE`, `ERROR`) wins over an indeterminate one and is `UNAVAILABLE`;
  an indeterminate required dependency (`TIMEOUT`, `RATE_LIMITED`,
  `NOT_CHECKED`) is `NOT_CHECKED`; an optional dependency that is not `OK`
  (including `NOT_CHECKED`) is `DEGRADED`; otherwise `HEALTHY`. An unknown or
  unchecked dependency can never silently produce `HEALTHY`.
- **Extension aggregation is not "worst state wins."** Per-capability results
  are always kept so partial availability is visible. The extension summary
  exposes `{ healthy, degraded, unavailable, notChecked, total }` plus the full
  capability list; the extension-level status is `HEALTHY` only if every
  capability is, `UNAVAILABLE` only if every capability is, `NOT_CHECKED` if
  none answered `HEALTHY` or `DEGRADED`, and `DEGRADED` otherwise.
- **Probes stay read-only.** They never execute Git operations, run tests,
  run scans, deploy, approve, write permissions, modify extension state,
  contact a provider merely to prove health, or send user credentials
  externally. A probe may only return `OK` / `MISSING` / `NOT_CONFIGURED`;
  anything else observed (timeouts, HTTP errors, thrown errors) is classified
  centrally by the engine, not by the probe.
- **Verified vs. runtime-verified.** The unit-tested engine, rule tables and
  classification are `VERIFIED` by `studio-extension-health.test.ts`. Two
  probes remain environment-dependent and are tracked separately, not folded
  into "Verified": `service.durable-store` against a live Supabase instance,
  and real Git execution against a live repository in an environment that has
  one. Neither blocker is disguised as a product defect, and neither is
  "verified" by weakening the probe or faking a response.

This section previously described the health check as an open decision; the
contract above is now implemented. What remains open is only whether future
capabilities need new dependency kinds (rule 5) — not the shape of the health
contract itself.

## 5. Compatibility and versions

Each manifest declares `version` (semver) and the minimum Studio version it
needs. An incompatible extension is shown, cannot be enabled, and is disabled
automatically if it was enabled. An installed version lower than the catalog
version shows "update available"; updating keeps grants and leaves new
permissions pending.

## 6. Future built-in extensions (direction, not current work)

Arlet, 2026-10-03: the extension system is the unified management layer for
Studio capabilities, and an extension need not mean outside code. In a
future, separately approved phase the following **may** become **Built-in**
extensions (enable/disable per project, explicit permissions, not
uninstallable):

- Terminal
- Smart completion
- Debug
- Agent, where appropriate

They are architectural possibilities, **not** non-goals and **not** current
implementation work. Nothing in this ADR implements them, adds them to the
catalog or changes the six extensions above; each needs its own definition and
approval first (rule 5).

## 7. Consequences

- Studio layout approved on 2026-10-03 is unchanged: extensions only add icons
  below Explorer and Search; Git's icon is now contributed by the built-in Git
  extension.
- The extension catalog is a Studio feature, not a marketplace: no listing of
  outside publishers, no payments, no ratings.
- Tests in `atlas-architecture-contracts.test.ts` assert the new contract
  (official-only, no third-party, no user JS, no server-side extension code,
  durable state, product goal).

## 8. Verification (2026-10-04, Studio-only verification pass)

Status vocabulary: `VERIFIED` / `IMPLEMENTED BUT NOT VERIFIED` / `BLOCKED` /
`MISSING` / `CONFLICTED`. This section is the result of exercising the
already-implemented platform against this ADR; it does not change the
decision or the implementation beyond one environment fix (below).

| Requirement | Status | Evidence |
|---|---|---|
| Extension identity stable; duplicate/unknown IDs rejected | `VERIFIED` | `routes/studio-extensions.test.ts` (14/14): unknown extension → 404/`UNKNOWN_EXTENSION`; gate rejects unknown/malformed `x-arletos-extension` → 403. Re-confirmed live: `fetch` with `arletos.does-not-exist` → 403 `UNKNOWN_EXTENSION`; `<script>...</script>` header value → 403 `Unknown Studio extension` (no reflection). |
| Installing grants nothing; permissions explicit, one by one, audited | `VERIFIED` | Live: installed "Cloud & deploy" → state "Installed · off", both permissions still "Waiting for approval"; granting one flips only that permission. |
| Unknown/undeclared permissions and routes fail closed | `VERIFIED` | `routes/studio-extensions.test.ts`: "blocks a disabled extension, an undeclared route and an unknown extension"; "limits the Git extension to read-only Git commands". |
| Server-side enforcement (`x-arletos-extension`) — permission not granted, not enabled, wrong route/command | `VERIFIED` | Live, direct `fetch` to the API (not UI-mediated): `PERMISSION_NOT_GRANTED` → 403, then 200 after granting; `NOT_ENABLED` → 403 after disabling with the permission still granted. |
| Health contract: dependency/capability/extension state rules | `VERIFIED` | `studio-extension-health.test.ts` (7/7, unit, synthetic manifest — contract §E/§F). |
| Health: Healthy, Unavailable, and Recovery (unavailable → healthy once the condition clears) | `VERIFIED` | Live: Git read `UNAVAILABLE` ("The live approval store is not configured here") while the local API process held a stale `SUPABASE_SERVICE_ROLE_KEY`; restarting the API process (the actual defect — see below) made the same project's Git and Tests & QA read `HEALTHY` without any code or data change — a genuine recovery transition, not a rerun of the same state. |
| Health: Degraded (capability-level, optional dependency) | `VERIFIED` (engine only) | `studio-extension-health.test.ts`: optional-dependency and partial-availability cases. Not reproduced against a real manifest — see Remaining gaps. |
| Health is informational: never blocks, grants or revokes | `VERIFIED` | Code path separation holds (`studio-extension-gate.ts` does not import the health module). Live: the Git panel rendered its buttons while `UNAVAILABLE`; `Request git status` remained clickable throughout. |
| Dashboard/catalog UI reflects loading, error, and empty states safely | `VERIFIED` | `EngineeringStatusCard.tsx`: `Skeleton` while loading, `Alert severity="warning"` on partial failure (`anyError`), default-to-zero counts via `?? []`/`?? 0`; `ExtensionsView`/`ExtensionDetail`: `Alert severity="error"` on query error, explicit `notFound`/`loading` text, no unguarded property access found in review. |
| Dynamic activity bar reflects real backend state | `VERIFIED` | Live: installing + enabling "Cloud & deploy" added its icon to the activity bar within one refetch; disabling removed it; no page reload. |
| i18n — en/he/ar/fr, no English leakage, no missing-key markers | `VERIFIED` | Live, all 4 locales: catalog, filters, state/health labels, permissions, capabilities, third-party note all render fully translated; evaluated DOM text for `MISSING_MESSAGE`/raw key patterns — none found. |
| RTL | `VERIFIED` | Live: `he` and `ar` both render `document.documentElement.dir === "rtl"` with the Extensions view laid out correctly. |
| Accessibility — distinct roles/regions, keyboard operability, disabled-state semantics | `VERIFIED`, one observation | Live: filter chips keyboard-operable (`Tab` + `Enter` toggles `aria-pressed`); each extension row, panel and detail page has a distinct `region`/`aria-label`. Observation (not a defect): the same extension's name legitimately appears twice in the DOM at once (activity-bar icon button and catalog list entry, e.g. both named "Git"), each in a different landmark (`toolbar` vs `region`). This mirrors how the catalog and activity bar are specified to work (same extension, two surfaces) and is not the duplicate-label defect fixed elsewhere in Studio (identical labels on two *different* things). No fix applied. |
| Project/user isolation — a project cannot see or mutate another project's extension state | `VERIFIED` | `routes/studio-extensions.test.ts`: "rejects a project the caller cannot access, wherever its id comes from" (header, query, and body paths, two real local identities, `bindProjectOwner`-scoped) and "only the project owner changes project-scope state". This is a real two-identity API-level test already in the suite — not invented for this pass. |
| Regression — other Studio surfaces unaffected | `VERIFIED` | `apps/api`: `web-studio-surfaces.test.ts` 16/16, `atlas-architecture-contracts.test.ts` 6/6; `apps/web`: `tsc --noEmit` clean. |

**Defect found and fixed:** none in the implementation. One **environment**
defect was found and corrected: the locally running API dev-server process
had been started while `apps/api/.env` temporarily held a non-live
`SUPABASE_SERVICE_ROLE_KEY` (from an earlier, unrelated verification pass)
and had not picked up the file's later revert, so `service.approval-store`
and the Git extension's health read `UNAVAILABLE`/`NOT_CONFIGURED` against a
correctly-configured environment. Restarting the process (no code change)
resolved it and produced the Recovery evidence above.

**Remaining gaps:**
- Extension-level `DEGRADED` (partial capability availability) is `VERIFIED`
  only against the synthetic manifest in `studio-extension-health.test.ts`.
  None of the 6 shipped manifests currently has two capabilities with
  different dependency sets or any `optional: true` dependency, so this state
  is not reachable through real data today. Not a defect — the rule is
  implemented and unit-tested; the shipped manifests simply never exercise
  it. No manifest change made (would be scope beyond this verification pass).
- `service.durable-store` against a live Supabase instance and real Git
  execution against a live repository remain environment-dependent probes,
  as already noted above (§4) — unchanged by this pass.
