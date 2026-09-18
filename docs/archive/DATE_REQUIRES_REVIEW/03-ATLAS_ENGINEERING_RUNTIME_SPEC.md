# 03 — ATLAS Engineering Runtime Spec

**Status:** Living — how the Tool Runtime, filesystem access, and data layer actually work. This is where doc 02's "Execution" stage is implemented, and where the currently-open security gaps live.
**Audience:** engineers touching `packages/agent-core/src/tools/*`, database/RLS, or anything a governed action's stage 5 (execution) reaches.
**Companions:** [`02-ATLAS_AGENT_GOVERNANCE_SPEC.md`](02-ATLAS_AGENT_GOVERNANCE_SPEC.md) (what decides whether execution is allowed to happen at all) · [`04-ATLAS_PRODUCTION_READINESS_CHECKLIST.md`](04-ATLAS_PRODUCTION_READINESS_CHECKLIST.md) (Phases 4-13 track exactly this layer; this doc explains *why*, that one tracks *status*)
**Source:** Blueprint §54-57 + direct code read, 2026-08-24, of `packages/agent-core/src/tools/runtime.ts` and `fs-tools.ts` (both read in full).

---

## 1. Tool Runtime design rules (as documented in the code itself, verified accurate)

`executeTool()` (`runtime.ts`) is the **one** entry point to a registered tool — there is deliberately no export that hands a caller a `ToolImplementation` directly. Four rules, in the order they matter:

1. **Fail closed.** A tool with no `ToolPolicy` entry is `DENIED`, never allowed "because nobody said no." A tool implementation registered without a matching policy is unreachable, not ungoverned.
2. **The runtime never approves.** A `requiresApproval` policy makes `executeTool()` return `APPROVAL_REQUIRED` without running anything — it does not call the approval service itself. That decision lives exactly once, in doc 02's `dispatchAgentAction`. This is the same "one decision, one place" principle as doc 02 §3, applied one layer down.
3. **Containment is checked in the runtime, not the tool.** Every filesystem tool receives an already-validated path — a tool implementation is not trusted to police its own arguments, because the whole point is that an agent chose them.
4. **Timeouts are enforced by the runtime**, not requested politely of the tool.

Rule 4 is currently **not actually true** — see §3 below. Documenting the rule and enforcing it are different things, and this spec exists partly to keep that gap visible instead of letting the comment stand in for the fact.

## 2. Path containment — `resolveInsideRoot()` — verified 2026-08-24

```ts
resolveInsideRoot(projectRoot, candidate)
```

Rejects: non-string/empty candidates, absolute paths (`isAbsolute()` — this is win32-aware on Windows, so it also rejects `C:\...` drive paths and `\\server\share` UNC paths), and any traversal that escapes the root **on the resolved, normalized path** — comparing via `relative()` rather than `startsWith()`, specifically to avoid the sibling-prefix trap (`/srv/app-evil` wrongly matching a `startsWith("/srv/app")` check).

**Verified covered:** `../` traversal, absolute paths, Windows drive paths, UNC paths, sibling-prefix confusion, path normalization.

**Verified NOT covered — real, open gap:** no canonicalization. The check is purely lexical (`resolve`/`relative` on strings); it never calls `fs.realpath` (or Node's `fs.realpath.native`) to resolve symlinks or Windows junctions to their real target before checking containment. Concretely: if `<projectRoot>/foo` is a symlink or a Windows directory junction pointing outside the project root, `resolveInsideRoot("foo")` computes a target that is lexically inside root and **passes**. `fs.read_file` and `fs.read_directory` then call `stat()` (which follows links) on that approved path — the actual read happens outside the project root.

**Required fix shape** (from doc 04 Phase 4, restated here as the concrete engineering task):

```
logical path → resolved path → REAL/CANONICAL path (fs.realpath) → canonical project root → containment check
```

The containment check must run on the canonical form of *both* the candidate and the root, and must be re-checked after resolution — a directory that is clean at containment-check time but is (or contains) a symlink is exactly the case this closes.

This matters specifically because the runtime is exercised on Windows (per `engines.node` in `package.json` and the user's actual dev environment) — junctions and reparse points are a live concern, not a theoretical POSIX-only one.

## 3. Cancellation — `withTimeout()` — verified 2026-08-24, real gap

Current implementation: a `Promise.race`-shaped helper using a plain `setTimeout`. When the timer fires first, `executeTool()` returns `{status: "TIMEOUT", timeoutMs}` to its caller — but the underlying `impl.run()` call (e.g. `fs-tools.ts`'s `walk()` recursively reading a large directory tree, or a large `readFile`) **is never told to stop**. It keeps running to completion (or to its own eventual error) with no one listening, consuming CPU/IO/memory for a request that has already "failed" from the caller's point of view.

**Required fix shape** (doc 04 Phase 5):

```
timeout → AbortController → AbortSignal → operation observes cancellation → workers/recursion stop → no orphan work
```

This requires `ToolExecutionContext` (or `ToolImplementation.run()`'s signature) to actually carry an `AbortSignal`, and every tool implementation that does I/O in a loop (`walk()` is the concrete example today) to check it between iterations. This is not implemented at all today — no `AbortController` import exists in `runtime.ts` or `fs-tools.ts`.

## 4. Resource limits — `fs-tools.ts` — verified 2026-08-24

| Limit | Status | Value | Note |
| --- | --- | --- | --- |
| Per-file read size | ✅ enforced | `MAX_FILE_BYTES = 256 * 1024` | `fs.read_file` throws above this |
| Directory listing size | ✅ enforced | `MAX_DIR_ENTRIES = 500` | truncation is reported, not silent |
| Search result count | ✅ enforced | `MAX_SEARCH_MATCHES = 200` | |
| Files scanned (search) | ❌ not enforced | — | `walk()` visits every file in the tree looking for matches; a repo with zero matches is fully walked |
| Total bytes scanned (search) | ❌ not enforced | — | only the per-file 256KB cap applies per file touched, no running total |
| Directory recursion depth | ❌ not enforced | — | `walk()` recursion is unbounded |
| Symlinks encountered | ❌ not enforced (and not really handled at all) | — | `readdir(..., {withFileTypes: true})` Dirent entries for a symlink report `isSymbolicLink(): true` and `isDirectory()/isFile(): false` for the link itself — `walk()`'s `if (entry.isDirectory()) ... else if (entry.isFile())` silently skips symlink entries. This means `fs.search_repo` *accidentally* doesn't traverse symlinked subtrees — but this is an omission, not a designed/tested control, and does nothing for `fs.read_file`/`fs.read_directory` being pointed at a symlink path directly (§2's gap) |
| Search duration | ❌ not enforced as its own budget | — | only the coarse per-tool `ToolPolicy.timeoutMs`, and per §3 that doesn't actually stop the work, only stops waiting for it |

Directories skipped by name (`SKIP_DIRS`: `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, `coverage`) apply to `readDirectoryTool` and `searchRepoTool`'s `walk()`. **`fs.read_file` does not consult `SKIP_DIRS` at all** — a direct `path: "node_modules/foo/index.js"` argument is read if `resolveInsideRoot` approves it (which it will, since it's a normal in-root relative path). Decide explicitly whether this is intended (agent may read any in-root file, but bulk search shouldn't scan dependencies) or a gap (agent should never reach `node_modules`/`.git` regardless of tool) — as of 2026-08-24 this is undecided, not a bug per se, but worth a deliberate call before it's relied upon.

## 5. Database / multi-tenancy / RLS (Blueprint §54-57 — status per `living-request-tracker.md`, not independently re-verified in this pass)

PostgreSQL is the core store where relational integrity, multi-tenancy, RLS, auditability, and vector retrieval matter. Hierarchy: `User → Organization → Membership → Project → Resources`. Per the living-request-tracker (theme #22, verified 2026-08-12, **not re-checked at the SQL level in this document's pass**): when Supabase is live, identity and roles come from the Auth JWT (`app_metadata.atlas_role` + `profiles.role`); local session auth is offline/dev fallback only. `created_by` on a memory or resource is provenance, never the authorization primitive (doc 02 §5).

**Explicitly unverified in this pass** (doc 04 Phase 13 status: ⬜ UNVERIFIED): actual RLS policy SQL (deny-by-default, negative tests, cross-tenant leakage tests). Do not treat the application-layer identity resolution above as proof that the database-layer RLS policies are correct — they are two different enforcement points and both need checking.

## 6. What this spec is not

This is not the place for: agent reasoning behavior (doc 01), the Policy/Risk/Approval decision logic (doc 02), or a phase-by-phase production checklist (doc 04). If a change here needs a new governance decision (e.g. "should `fs.read_file` respect `SKIP_DIRS`"), record the decision in doc 02, not by silently changing behavior in this layer.
