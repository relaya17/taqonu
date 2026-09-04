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
writes the nginx config bound to your Tailscale IP, and locks the firewall down
to `deny incoming`.

It deliberately leaves the services **stopped** until you supply configuration.

### Fill in configuration

```bash
sudo -e /etc/atlas/control-plane.env
sudo -e /etc/atlas/admin.env
sudo -e /etc/atlas/worker.env
```

Generate tokens with `openssl rand -base64 48`. Two rules:

- `ATLAS_CONTROL_PLANE_TOKEN` (OPERATOR) and `ATLAS_CONTROL_PLANE_OWNER_TOKEN`
  (OWNER) must be **different** values.
- `ATLAS_CONTROL_PLANE_TOKEN` must be **identical** in `control-plane.env` and
  `admin.env`.
- Rotation: set the new current token, keep the retiring value in
  `ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS` (and
  `ATLAS_CONTROL_PLANE_OWNER_TOKEN_PREVIOUS` when rotating the owner secret)
  on Control, Admin, and the tenant API. Restart those processes, then
  remove PREVIOUS after every process has the new current. Do not leave
  PREVIOUS set indefinitely.

Then put the same operator token into the nginx snippet:

```bash
sudo -e /etc/nginx/snippets/atlas-admin-auth.conf   # replace __TOKEN__
sudo nginx -t && sudo systemctl reload nginx
```

Do not use the literal placeholder `12345678901234567890123456789012` for
`ENCRYPTION_KEY` or `COOKIE_SECRET`; `assertNotExampleSecrets()` rejects it.

### A dotenv file outranks systemd

`loadServerDotEnv()` in `packages/config/src/load-dotenv.ts` reads
`/opt/atlas/.env` with `override: false` and then `/opt/atlas/apps/api/.env`
with **`override: true`**. The second one beats every variable systemd passes
through `EnvironmentFile`, so a stray file there could silently drop a service
to `NODE_ENV=development` and someone else's credentials.

Both paths are gitignored, so a clean `git clone` has neither. `verify.sh`
fails the run if either appears.

### Start

```bash
sudo systemctl enable --now atlas-control-plane atlas-admin atlas-worker
sudo /opt/atlas/deploy/verify.sh
```

### Update later

```bash
sudo /opt/atlas/deploy/bootstrap.sh --update
sudo systemctl restart atlas-control-plane atlas-admin atlas-worker
```

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

`deploy/verify.sh` automates all of these. Run it after every deployment.

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
- [ ] `/etc/atlas/*.env` are mode `640` or `600`
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
