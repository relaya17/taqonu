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
(Stage 4 of the extension plan) needs its own ADR covering an API contract,
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
  project, so its capabilities actually answer.

## 5. Compatibility and versions

Each manifest declares `version` (semver) and the minimum Studio version it
needs. An incompatible extension is shown, cannot be enabled, and is disabled
automatically if it was enabled. An installed version lower than the catalog
version shows "update available"; updating keeps grants and leaves new
permissions pending.

## 6. Consequences

- Studio layout approved on 2026-10-03 is unchanged: extensions only add icons
  below Explorer and Search; Git's icon is now contributed by the built-in Git
  extension.
- The extension catalog is a Studio feature, not a marketplace: no listing of
  outside publishers, no payments, no ratings.
- Tests in `atlas-architecture-contracts.test.ts` assert the new contract
  (official-only, no third-party, no user JS, no server-side extension code,
  durable state, product goal).
