# `deploy/` — Atlas private plane artifacts

Configuration for running Control and Atlas Admin on a private VM, per
[ADR-021](../docs/adr/ADR-021-private-by-default-control-plane.md) (amended 2026-09-02).

Full guide: [`docs/deployment/private-plane.md`](../docs/deployment/private-plane.md)

| Path | Purpose |
| --- | --- |
| `bootstrap.sh` | Idempotent VM provisioning. `--update` pulls and rebuilds. Ends with an explicit READY / BLOCKED / REQUIRES OWNER INPUT verdict. |
| `generate-tokens.sh` | Safely fills empty, safely-generatable secrets (control-plane tokens, worker crypto keys). Never overwrites an existing value — rotation is always a separate, explicit action. |
| `validate-production-env.sh` | The authoritative environment gate. Static, read-only, secret-safe. Exit `0`=READY, `1`=BLOCKED (fixable locally), `2`=REQUIRES OWNER INPUT (external value missing). Run by both `bootstrap.sh` and `verify.sh`; safe to run standalone at any time. |
| `validate-production-env.test.sh` | Self-test suite for the validator above — disposable fixture env files, never real secrets. Run after changing the validator. |
| `verify.sh` | Read-only post-deployment checks (runs the validator first, then live/runtime checks). Exits non-zero on failure. |
| `systemd/atlas-control-plane.service` | Control Plane on `127.0.0.1:3100` |
| `systemd/atlas-admin.service` | Atlas Admin on `127.0.0.1:3200` |
| `systemd/atlas-worker.service` | Worker loop, no HTTP surface |
| `nginx/atlas-admin.conf` | Tailscale-only reverse proxy for Atlas Admin |
| `env/*.env.example` | Environment templates — **variable names only** |

## Scope

Covers `apps/control-plane`, `apps/admin` and `apps/worker` only.

`apps/web` and `apps/api` are the USER plane and deploy to Vercel from their own
`vercel.json`. Never move Control Plane or Admin to Vercel — see the guide for
why the previous attempt returned `FUNCTION_INVOCATION_FAILED`.

## Rules

- No real secret ever belongs in this directory. Templates carry names only.
- `bootstrap.sh` never overwrites an existing `/etc/atlas/*.env`.
- `generate-tokens.sh` never overwrites an existing, non-empty value in any
  env file — it only ever fills a line that is present and empty. Rotating a
  token that is already set is a deliberate, separate action (see the guide's
  "Rotating a token" section), never a side effect of re-running a script.
- `validate-production-env.sh` never invents a value for `WEB_ORIGIN`,
  `ATLAS_API_URL`, or any Supabase/database credential — those are reported
  as **REQUIRES OWNER INPUT** until a human supplies them. In particular,
  `http://127.0.0.1:3100` is never accepted as `ATLAS_API_URL`: that is the
  Control Plane's own loopback address, not the production API.
- Services bind `127.0.0.1`. The only ingress is nginx on the Tailscale IP.
- No public port is opened, including 80 and 443.

## Quick start

```bash
sudo ./bootstrap.sh                          # provision + auto-fill safe secrets
                                              # (leaves services stopped; ends
                                              # with a READY/BLOCKED/OWNER
                                              # verdict — read it before continuing)
sudo -e /etc/atlas/control-plane.env         # fill in WEB_ORIGIN, ATLAS_API_URL
sudo -e /etc/atlas/worker.env                # fill in DATABASE_URL, SUPABASE_*
sudo ./validate-production-env.sh            # re-check until it says READY
sudo systemctl enable --now atlas-control-plane atlas-admin atlas-worker
sudo ./verify.sh                             # confirm it works and is still private
```

`admin.env` normally needs no manual editing: `generate-tokens.sh` copies the
operator token into it automatically once `control-plane.env` has one.
