# Atlas private plane deployment (ADR-021)

How to run `apps/control-plane`, `apps/admin` and `apps/worker` on a private VM.

These three are the **CONTROL** trust plane. They must never be reachable from
the public internet and must never run on serverless. `apps/web` and `apps/api`
stay on Vercel and are out of scope here.

| Plane | Application | Runtime | Port | Host |
| --- | --- | --- | --- | --- |
| USER | `apps/web` | Next.js 15 | 3000 | Vercel (public) |
| USER | `apps/api` | Fastify → serverless bundle | 4000 | Vercel (public) |
| CONTROL | `apps/control-plane` | Node HTTP, long-lived | 3100 | **private VM** |
| CONTROL | `apps/admin` | Node HTTP, long-lived | 3200 | **private VM** |
| CONTROL | `apps/worker` | polling loop, no HTTP | — | **private VM** |

---

## Why Admin cannot run on Vercel

`apps/admin/src/server.ts` ends with `server.listen(PORT, HOST)` where `HOST`
defaults to `127.0.0.1`. That is a long-lived listener bound to loopback, not an
exported serverless handler. A Vercel Node function has no handler to invoke, so
every request fails with `FUNCTION_INVOCATION_FAILED`.

Even if a handler existed, `admin-auth.ts` returns **503** under
`NODE_ENV=production` without `ATLAS_CONTROL_PLANE_TOKEN`, and the app reads all
of its content from the Control Plane on `:3100`, which is also not on Vercel.

The 500s on the old Admin URLs are a correctly-secured application refusing to
run in the wrong place. Fixing them means moving the app, not changing the code.

---

## Prerequisites

- Ubuntu 24.04 LTS VM — 2 vCPU / 4 GB RAM / 40 GB SSD (≈ $4–6/month)
  - 1 vCPU / 2 GB is enough if you build in CI and ship artifacts
- A Tailscale account (free tier is sufficient)
- SSH access to the VM
- Values only you can supply — this migration's scripts will never invent
  them (see [External values you must supply](#external-values-you-must-supply)):
  the real production `WEB_ORIGIN` and `ATLAS_API_URL` (your `apps/web` /
  `apps/api` Vercel URLs) and your Supabase project's `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL`.

Runtime pinned by the repo: **Node 22** (`engines: { node: ">=22" }`) and
**pnpm 10.28.2** (`packageManager` in the root `package.json`).

---

## Install

```bash
# On the VM
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

git clone https://github.com/relaya17/taqonu.git /tmp/atlas-bootstrap
sudo /tmp/atlas-bootstrap/deploy/bootstrap.sh
```

`bootstrap.sh` is idempotent and never overwrites an existing `/etc/atlas/*.env`.
It installs Node and pnpm, creates the `atlas` service account, clones to
`/opt/atlas`, builds only the three private apps, installs the systemd units,
writes the nginx config bound to your Tailscale IP, locks the firewall down to
`deny incoming`, then runs the full pipeline below and ends with an explicit
**READY / BLOCKED / REQUIRES OWNER INPUT** verdict.

It deliberately leaves the services **stopped** until that verdict is READY.

### What bootstrap.sh does with your env files, step by step

1. **Preflight** — installs packages, Node, pnpm, Tailscale (section 1).
2. **Env files created from template, never overwritten** — the first run
   copies `deploy/env/*.env.example` to `/etc/atlas/*.env` with every value
   blank; a later run leaves an existing file untouched, in full.
3. **Auto-fill safely-generatable secrets** (`deploy/generate-tokens.sh`) —
   fills `ATLAS_CONTROL_PLANE_TOKEN` and `ATLAS_CONTROL_PLANE_OWNER_TOKEN` in
   `control-plane.env` (guaranteed distinct), `ENCRYPTION_KEY` and
   `COOKIE_SECRET` in `worker.env`, and copies the operator token into
   `admin.env` — but **only ever into a line that is present and empty**.
   It never overwrites a value that is already set: rotating an existing
   token is a separate, explicit action (see
   [Rotating a token](#rotating-a-token)), never something a script does for
   you silently. Safe to re-run any time — a fully-configured install is
   always a no-op here.
4. **External dependency check / security validation / explicit startup
   gate** (`deploy/validate-production-env.sh`) — the single authoritative
   check, run automatically at the end of `bootstrap.sh` and again by
   `verify.sh`. See [Validate before starting](#validate-before-starting).

### External values you must supply

Nothing in this repository can generate or guess these — they come from
Vercel and Supabase, or from you directly. `deploy/validate-production-env.sh`
reports each one as **REQUIRES OWNER INPUT**, never as a silent default,
until it is filled in:

| Variable | File | Where it comes from |
| --- | --- | --- |
| `WEB_ORIGIN` | `control-plane.env` | your `apps/web` production URL/domain on Vercel |
| `ATLAS_API_URL` | `control-plane.env` | your `apps/api` production URL on Vercel — **never** `http://127.0.0.1:3100`; that is the Control Plane's own loopback address, not the API |
| `DATABASE_URL` | `worker.env` | your database connection string |
| `SUPABASE_URL` | `worker.env` | your Supabase project |
| `SUPABASE_ANON_KEY` | `worker.env` | your Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | `worker.env` | your Supabase project |

Edit these by hand:

```bash
sudo -e /etc/atlas/control-plane.env
sudo -e /etc/atlas/worker.env
```

Everything else in those two files, plus all of `admin.env`, is either
auto-filled by `deploy/generate-tokens.sh` in step 3 above or has a safe
built-in default (`APP_NAME`, `PRODUCT_CODENAME`, `ATLAS_QUEUE_PATH`,
`ATLAS_REPO_ROOT`, `ATLAS_CP_AUDIT_SYNC`) — you should rarely need `nano` for
anything beyond the table above.

### Validate before starting

```bash
sudo /opt/atlas/deploy/validate-production-env.sh
```

This is the single authoritative gate `bootstrap.sh` and `verify.sh` both
call. It never prints a secret value — only `PRESENT` / `EMPTY` / `MATCH` /
`MISMATCH` / `DUPLICATE` against a variable **name**, and it exits with one
of three codes:

| Exit | Verdict | Meaning |
| --- | --- | --- |
| `0` | **READY** | Every check passed. Safe to start services. |
| `1` | **BLOCKED** | A locally-fixable problem exists: a duplicate variable, bad file permissions/ownership, an operator token equal to the owner token, an admin token that doesn't match the Control Plane's, or a malformed/loopback URL where a public one is required. None of these need external input — fix them and re-run. |
| `2` | **REQUIRES OWNER INPUT** | Everything locally checkable is correct. The only gaps left are the external values in the table above. |

It also cross-checks the nginx auth snippet
(`/etc/nginx/snippets/atlas-admin-auth.conf`) against the operator token, so a
stale bearer header there is caught before you rely on the Owner UI.

Run `deploy/validate-production-env.test.sh` after changing the validator
itself — it exercises all of the cases above (and more) against disposable,
fake fixture values, never real secrets.

### Rotating a token

`deploy/generate-tokens.sh` will never do this for you — rotation is a
deliberate, explicit action with restart/coordination steps, not something
that should ever happen as a side effect of re-running a provisioning script:

1. Set the new current token, keeping the retiring value in
   `ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS` (and
   `ATLAS_CONTROL_PLANE_OWNER_TOKEN_PREVIOUS` when rotating the owner secret)
   on Control, Admin, and the tenant API.
2. Restart those processes.
3. Once every process has the new current value, remove `_PREVIOUS`. Do not
   leave it set indefinitely.

Then put the same operator token into the nginx snippet:

```bash
sudo -e /etc/nginx/snippets/atlas-admin-auth.conf   # replace __TOKEN__
sudo nginx -t && sudo systemctl reload nginx
```

Do not use the literal placeholder `12345678901234567890123456789012` for
`ENCRYPTION_KEY` or `COOKIE_SECRET`; `assertNotExampleSecrets()` rejects it.
(`deploy/generate-tokens.sh` never produces this value.)

### A dotenv file outranks systemd

`loadServerDotEnv()` in `packages/config/src/load-dotenv.ts` reads
`/opt/atlas/.env` with `override: false` and then `/opt/atlas/apps/api/.env`
with **`override: true`**. The second one beats every variable systemd passes
through `EnvironmentFile`, so a stray file there could silently drop a service
to `NODE_ENV=development` and someone else's credentials.

Both paths are gitignored, so a clean `git clone` has neither. `verify.sh`
fails the run if either appears.

### Start

Only once `deploy/validate-production-env.sh` (or `bootstrap.sh`'s own final
report) says **READY**:

```bash
sudo systemctl enable --now atlas-control-plane atlas-admin atlas-worker
sudo /opt/atlas/deploy/verify.sh
```

Startup order, and what to do if one step fails: validate env → validate
nginx (`nginx -t`) → start Control Plane → confirm it answers
`/api/v1/status` → start Admin → confirm it answers → start Worker → confirm
its unit stays active. If any step fails, stop and read that unit's journal
(`journalctl -u <unit> -n 50`) rather than starting the next one — a failure
at one layer (e.g. Control Plane refusing to bind because `ATLAS_API_URL` is
still loopback) will otherwise cascade into confusing failures at the next.

### Update later

```bash
sudo /opt/atlas/deploy/bootstrap.sh --update
sudo systemctl restart atlas-control-plane atlas-admin atlas-worker
```

---

## Recovering from a failed or partial deployment

`bootstrap.sh` is safe to re-run at any point — every step in it is
idempotent (packages are only installed if missing, source is pulled not
re-cloned, env files and the nginx snippet are never overwritten once they
exist, secrets are only ever filled into an empty line). If a run fails
partway through:

1. Re-run `sudo /opt/atlas/deploy/bootstrap.sh` — it picks up from wherever
   it left off rather than starting over.
2. If the failure was in the build step, check `pnpm install` / `turbo run
   build` output directly; nothing downstream (env files, secrets, systemd,
   nginx) is touched until the build succeeds.
3. If services were already started and are now unhealthy after a config
   change, `sudo systemctl stop atlas-control-plane atlas-admin
   atlas-worker`, fix the flagged `.env` file, re-run
   `deploy/validate-production-env.sh` until it says READY, then start again
   in the order under [Start](#start).
4. `/etc/atlas/*.env` and `/etc/nginx/snippets/atlas-admin-auth.conf` are
   the only state this migration asks you to hand-edit. Back them up before
   any manual change you're unsure about — there is no automatic backup
   mechanism for them beyond your own copy.

---

## Reconciling an already-bootstrapped VM

`deploy/bootstrap.sh` is for first provisioning (or a `--update` pull). Once a
VM has already been bootstrapped and may have services intentionally stopped
(e.g. while external values are still being filled in), use
`deploy/reconcile-production-vm.sh` instead of re-running bootstrap blindly —
it inspects the current state against the finalized repository tooling rather
than reinstalling anything.

It has three modes, never combined:

```bash
sudo bash deploy/reconcile-production-vm.sh --check    # default; strictly read-only
sudo bash deploy/reconcile-production-vm.sh --repair   # + the two whitelisted safe repairs
sudo bash deploy/reconcile-production-vm.sh --start    # + the startup sequence, gate-permitting
```

`--check` (the default with no flag) inspects everything — repository
version, env files, nginx, systemd, network, build artifacts — and mutates
nothing: not `/etc/atlas`, not nginx, not systemd, not the repository.

`--repair` does everything `--check` does, plus (only if the repository
version gate passes) runs `deploy/generate-tokens.sh` and corrects env-file
permissions/ownership — never starts, reloads, or enables anything, and
takes a non-secret backup manifest first (see below). If the checkout on the
VM is missing, dirty, or does not contain the expected commit, `--repair`
refuses to touch anything: no token generation, no `chmod`/`chown`. Fix the
repository first.

`--start` re-runs the full read-only check and, only if every gate is
satisfied (installation, configuration, and network all `PASS`), starts
`atlas-control-plane` → verify → `atlas-admin` → verify → `atlas-worker` →
verify, stopping immediately and reporting on the first failure. It never
repairs; run `--repair` first if `--check` reports anything fixable locally.

**Pre-start checks never require the services this run is about to start to
already be listening** — that would be a startup deadlock (`--start`
refusing to start a service because the port it hasn't bound *yet* isn't
bound). A service's own port not being up before startup is
`EXPECTED_INACTIVE` in every mode, including `--start`; a real problem (a
port already bound to a public interface) is still a pre-start `BLOCKED`
regardless of mode. Once the start sequence itself completes, a dedicated
**post-start verification** step re-checks — for real, against the live
system, independent of what `systemctl` itself claims — that `:3100`,
`:3200`, and `:8443` actually came up loopback/tailnet-only, and that the
Control Plane answers a live `/api/v1/status` health check. That post-start
step is the only place in the script allowed to call a missing listener a
failure; if it fails, `POST_START_STATUS=FAIL` and `OVERALL_STATUS` is
never `READY_FOR_START`.

It prints a machine-readable summary block at the end (`REPO_STATUS=`,
`ENV_STATUS=`, `TOKEN_ACTION=`, `NGINX_CONFIG_STATUS=`,
`NGINX_LISTENER_STATUS=`, `SYSTEMD_STATUS=`, `NETWORK_STATUS=`,
`BUILD_STATUS=`, `INSTALLATION_STATUS=`, `CONFIGURATION_STATUS=`,
`RUNTIME_STATUS=`, `STARTUP_READINESS=`, `POST_START_STATUS=`,
`MISSING_VARIABLES=`, `ERROR_CODES=`, `OVERALL_STATUS=`), and never prints a
secret value — token actions are reported as `KEEP_EXISTING` /
`GENERATE_MISSING` / `NO_ACTION` against a variable **name**, exactly like
`generate-tokens.sh` itself.

Its `--repair`-mode backup writes a `manifest.json` alongside the byte-for-byte
env/nginx-snippet copies, listing only the UTC timestamp, hostname,
repository HEAD/branch, and each backed-up file's path/permissions/owner —
never file content, never a secret.

Run `deploy/reconcile-production-vm.test.sh` after changing this script — it
exercises the repository gate, both check/repair modes, the URL and token
edge cases, the pre-start/post-start listener split (including a genuine
`--start` from a fully cold state, and a service that reports active but
never binds its port), service-start-failure ordering, and idempotency
against disposable fixtures, never the real system.

---

## Accessing the Owner UI

```
your browser
    │  WireGuard, device-authenticated
    ▼
Tailscale  100.x.y.z:8443
    │
    ▼
nginx ──[ injects Authorization: Bearer … ]──► 127.0.0.1:3200
```

Open `http://<tailscale-ip>:8443/` from any device on your tailnet.

### Why the proxy injects a header

`ATLAS_CONTROL_PLANE_TOKEN` does double duty in `apps/admin`:

- **outbound** — `server.ts` sends it to the Control Plane
- **inbound** — `admin-auth.ts` requires it on requests arriving at Admin

Setting it (which you must, or Admin cannot reach the Control Plane) turns on the
inbound bearer check, and a browser cannot send that header from the URL bar.
Note that once a token is set, the loopback bypass in `admin-auth.ts` no longer
applies — the token always wins.

nginx supplies the header so the UI is usable, while Tailscale authenticates the
device. Both layers stay intact; no application code is weakened.

---

## Network model

**Nothing inbound from the public internet. No port forwarding. No public TLS
certificate** — Tailscale already encrypts the path.

| Listener | Bind | Reachable from |
| --- | --- | --- |
| control-plane | `127.0.0.1:3100` | the VM only |
| admin | `127.0.0.1:3200` | the VM only |
| nginx | `<tailscale-ip>:8443` | your tailnet only |
| worker | none | — |

Firewall: `default deny incoming`, `allow in on tailscale0`, `allow 41641/udp`.

### Vercel does not need to reach this VM

```23:32:apps/api/src/services/control-plane-bridge.ts
/**
 * Application → Control Plane: forward selected domain events through the
 * Atlas Gateway. Fail-open — tenant work must not break if :3100 is down.
 */
export function registerControlPlaneBridge(): () => void {
  return domainEventBus.subscribe("*", (event) => {
    const mapped = GATEWAY_MAP[event.type];
    if (!mapped) return;
    const base = controlPlaneUrl();
    if (!base) return;
```

The bridge is fail-open by design. Leave `ATLAS_CONTROL_PLANE_URL` unset on
Vercel and the API skips it entirely; tenant traffic is unaffected whether the VM
is up, down, or absent.

The one link that does exist runs the other way: `audit-sync.ts` in the Control
Plane pushes audit entries **outbound** to the public API so they land in the
canonical hash-chain. Outbound HTTPS needs no inbound rule. Set
`ATLAS_CP_AUDIT_SYNC=0` to disable it.

---

## Verification checklist

`deploy/verify.sh` automates all of these. Run it after every deployment. Its
first section (`0. Static production environment validation`) is
`deploy/validate-production-env.sh` — everything below that was previously a
second, separately-maintained implementation of the permission/ownership
checks; that duplication has been removed, and `verify.sh` now delegates to
the one script that owns those checks.

### Static, pre-startup (deploy/validate-production-env.sh)
- [ ] No duplicate variable definitions in any of the three env files
- [ ] `/etc/atlas/*.env` are mode `640` or `600`, owned `root:atlas`
- [ ] `ATLAS_CONTROL_PLANE_TOKEN` ≠ `ATLAS_CONTROL_PLANE_OWNER_TOKEN`
- [ ] Admin's `ATLAS_CONTROL_PLANE_TOKEN` matches Control Plane's exactly
- [ ] `WEB_ORIGIN` and `ATLAS_API_URL` are non-loopback `https://` URLs
- [ ] `ATLAS_CONTROL_PLANE_URL` in `admin.env` is loopback `http://127.0.0.1:<port>`
- [ ] Worker's secrets pass the real `@atlas/config` `loadServerEnv()` check
- [ ] nginx auth snippet's bearer token matches the current operator token

### Runtime
- [ ] Node ≥ 22
- [ ] `atlas-control-plane`, `atlas-admin`, `atlas-worker` are all `active`

### Control Plane
- [ ] `GET /api/v1/status` → **200** (the one public path, by design)
- [ ] `GET /api/v1/agents` without a token → **401/403**
- [ ] `GET /api/v1/agents` with the operator token → **200**

### Atlas Admin
- [ ] `GET /` without a token → **200** promo HTML (not a privileged surface)
- [ ] `GET /api/v1/platform/hierarchy` without a token → **401** (token set) or **503** (token missing)
- [ ] `GET /` with the operator token → **200** platform HTML
- [ ] Browsing `http://<tailscale-ip>:8443/` renders Atlas Admin (not a Control dashboard clone)
- [ ] `GET /api/v1/platform/hierarchy` with auth → Admin supervises Control and Studio

### Private-by-default
- [ ] `:3100` and `:3200` bound to `127.0.0.1`, never `0.0.0.0`
- [ ] nginx bound to the Tailscale IP, never `0.0.0.0`
- [ ] `ufw` default is deny-incoming
- [ ] The URL is unreachable from a device outside the tailnet
- [ ] No `/opt/atlas/.env` or `/opt/atlas/apps/api/.env` outranking systemd

### Completed system undisturbed
- [ ] Fabric projection still exposes **16** agents
- [ ] Portfolio view still reports `ingestEnabled: false`
- [ ] `pnpm test:unit` still passes 1,953/1,953 from a clean checkout

## Disaster recovery, signing, external security

These are not systemd units on the VM:

- Canonical audit DR: `docs/operations/disaster-recovery.md` / `pnpm dr:drill`
- SBOM / unsigned provenance / fail-closed signing: `docs/security/supply-chain.md`
- External pentest package (not a completed test): `docs/security/pentest-readiness.md`

---

## What was rehearsed before any VM existed

Both servers were started from their built `dist/` on loopback ports 3101/3201
with `NODE_ENV=production` and a throwaway token, then probed with the same
requests `verify.sh` issues.

**Proven.** Both boot from `dist/` with no stderr. Control Plane answers
`/api/v1/status` 200 unauthenticated, `/api/v1/agents` 401 unauthenticated and
200 with a bearer token. `fabric-projection` returns exactly 16 `agentId`
entries and the Portfolio view reports `ingestEnabled: false`. Admin returns 401
without a token and 200 with one, rendering 81 KB of HTML with no "Control Plane
unreachable" banner — meaning the Admin → Control Plane hop authenticated and
returned live data. That hop is precisely what fails on Vercel.

Current Admin unauth posture (2026-09-05): promo `GET /` is 200; privileged
`GET /api/v1/platform/hierarchy` is 401 when a token is configured. Do not
treat the historical “Admin `/` returns 401” rehearsal line as the live check.

**Not proven, because it needs the VM.** systemd hardening under
`ProtectSystem=strict`, the nginx header injection, the Tailscale bind, ufw, and
the worker running against real secrets. Static analysis says the hardening is
sound — Control Plane performs no filesystem writes at all, and the worker
writes only to `ATLAS_QUEUE_PATH`, which `ReadWritePaths=/var/lib/atlas` covers
— but that remains inference until `verify.sh` runs on the host.

The local worker start is **not** evidence: this workstation has an untracked
`apps/api/.env` supplying the six production secrets, so the run never exercised
`assertProductionSecrets()`.

---

## The old Vercel Admin deployments

`admin-tuae.vercel.app` and `admin-sable-omega-84.vercel.app` are obsolete
deployment targets for this application.

**Do not delete or pause them until the private deployment passes verification.**
They are safe as-is: the function crashes before a single line of application
code executes, so no authentication is bypassed and no data is exposed — they
return an empty 500.

Sequence:

1. **Now** — leave untouched.
2. **After `verify.sh` passes** — `pause` them. Pausing is reversible; deletion
   is not.
3. **Later, at your discretion** — delete, once you are satisfied the private
   plane is stable.

Neither project appears in the connected Vercel account (`arlet's projects`
contains only `taqonu-web`), so pausing requires signing into whichever account
owns them.

---

## Known limitation: the worker has no job producer

`enqueue()` is exported from `apps/worker/src/index.ts` but is called only by
that module's own tests. No code in `apps/api` calls it. The worker reads
`.atlas/worker-queue.json` from its own disk, and the API runs on Vercel's
ephemeral filesystem, so the two cannot share a queue.

Deploying the worker is architecturally correct and it will start cleanly,
recover jobs across restarts, and log `worker_idle` on a loop — but it will not
process anything until a shared producer exists. That is a separate piece of
work and is out of scope for this migration.

---

## Related

- [ADR-021 — Private-by-default and a separate Atlas Control Plane](../adr/ADR-021-private-by-default-control-plane.md)
- [`deploy/`](../../deploy/) — systemd units, nginx config, env templates, scripts
- `deploy/validate-production-env.sh` — the authoritative READY / BLOCKED /
  REQUIRES OWNER INPUT gate, run by both `bootstrap.sh` and `verify.sh`
- `deploy/validate-production-env.test.sh` — its self-test suite (disposable
  fixtures, no real secrets)
- `deploy/generate-tokens.sh` — safe, non-rotating generator for the secrets
  Atlas can create itself
- `deploy/reconcile-production-vm.sh` — read-only-by-default reconciliation
  for an already-bootstrapped VM; see
  [Reconciling an already-bootstrapped VM](#reconciling-an-already-bootstrapped-vm)
- `deploy/reconcile-production-vm.test.sh` — its self-test suite (disposable
  fixtures, no real secrets)
