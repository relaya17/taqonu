# `deploy/` — Atlas private plane artifacts

Configuration for running the **CONTROL** trust plane on a private VM, per
[ADR-021](../docs/adr/ADR-021-private-by-default-control-plane.md).

Full guide: [`docs/deployment/private-plane.md`](../docs/deployment/private-plane.md)

| Path | Purpose |
| --- | --- |
| `bootstrap.sh` | Idempotent VM provisioning. `--update` pulls and rebuilds. |
| `verify.sh` | Read-only post-deployment checks. Exits non-zero on failure. |
| `systemd/atlas-control-plane.service` | Control Plane on `127.0.0.1:3100` |
| `systemd/atlas-admin.service` | Owner Admin on `127.0.0.1:3200` |
| `systemd/atlas-worker.service` | Worker loop, no HTTP surface |
| `nginx/atlas-admin.conf` | Tailscale-only reverse proxy for the Owner UI |
| `env/*.env.example` | Environment templates — **variable names only** |

## Scope

Covers `apps/control-plane`, `apps/admin` and `apps/worker` only.

`apps/web` and `apps/api` are the USER plane and deploy to Vercel from their own
`vercel.json`. Never move Control Plane or Admin to Vercel — see the guide for
why the previous attempt returned `FUNCTION_INVOCATION_FAILED`.

## Rules

- No real secret ever belongs in this directory. Templates carry names only.
- `bootstrap.sh` never overwrites an existing `/etc/atlas/*.env`.
- Services bind `127.0.0.1`. The only ingress is nginx on the Tailscale IP.
- No public port is opened, including 80 and 443.

## Quick start

```bash
sudo ./bootstrap.sh                 # provision (leaves services stopped)
sudo -e /etc/atlas/admin.env        # fill in configuration
sudo systemctl enable --now atlas-control-plane atlas-admin atlas-worker
sudo ./verify.sh                    # confirm it works and is still private
```
