#!/usr/bin/env bash
#
# Atlas private control plane — VM bootstrap.
#
# Provisions apps/control-plane (:3100), apps/admin (:3200) and apps/worker on a
# single Ubuntu 24.04 VM, per ADR-021. Nothing is exposed publicly: the services
# bind 127.0.0.1 and the only ingress is nginx listening on the Tailscale IP.
#
# Idempotent. Never overwrites an existing /etc/atlas/*.env.
#
# Usage:
#   sudo ./bootstrap.sh              # full provision
#   sudo ./bootstrap.sh --update     # pull + rebuild + restart only
#
set -euo pipefail

ATLAS_ROOT="/opt/atlas"
ATLAS_ETC="/etc/atlas"
ATLAS_STATE="/var/lib/atlas"
ATLAS_USER="atlas"
REPO_URL="https://github.com/relaya17/taqonu.git"
NODE_MAJOR="22"
PNPM_VERSION="10.28.2"
SERVICES=(atlas-control-plane atlas-admin atlas-worker)

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"

UPDATE_ONLY=false
[[ "${1:-}" == "--update" ]] && UPDATE_ONLY=true

# ── 1. Packages ───────────────────────────────────────────────────────────
if ! $UPDATE_ONLY; then
  log "Installing base packages"
  apt-get update -qq
  apt-get install -y -qq curl git ufw nginx ca-certificates gnupg

  if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
    log "Installing Node.js ${NODE_MAJOR}.x"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -qq nodejs
  fi
  log "Node $(node -v)"

  corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
  log "pnpm $(pnpm -v)"

  if ! command -v tailscale >/dev/null; then
    log "Installing Tailscale"
    curl -fsSL https://tailscale.com/install.sh | sh
    warn "Run 'sudo tailscale up' now, then re-run this script."
  fi
fi

# ── 2. Service account and directories ────────────────────────────────────
if ! id -u "$ATLAS_USER" >/dev/null 2>&1; then
  log "Creating service account '${ATLAS_USER}'"
  useradd --system --create-home --shell /usr/sbin/nologin "$ATLAS_USER"
fi

install -d -o root         -g "$ATLAS_USER" -m 0750 "$ATLAS_ETC"
install -d -o "$ATLAS_USER" -g "$ATLAS_USER" -m 0750 "$ATLAS_STATE"

# ── 3. Source ─────────────────────────────────────────────────────────────
if [[ -d "$ATLAS_ROOT/.git" ]]; then
  log "Updating source"
  sudo -u "$ATLAS_USER" git -C "$ATLAS_ROOT" pull --ff-only
else
  log "Cloning source"
  install -d -o "$ATLAS_USER" -g "$ATLAS_USER" -m 0755 "$ATLAS_ROOT"
  sudo -u "$ATLAS_USER" git clone "$REPO_URL" "$ATLAS_ROOT"
fi

# ── 4. Build (private plane only — never apps/web or apps/api) ────────────
log "Installing dependencies"
sudo -u "$ATLAS_USER" bash -lc "cd '$ATLAS_ROOT' && pnpm install --frozen-lockfile"

log "Building control-plane, admin, worker"
sudo -u "$ATLAS_USER" bash -lc "cd '$ATLAS_ROOT' && pnpm exec turbo run build \
  --filter=@atlas/control-plane --filter=@atlas/admin --filter=@atlas/worker"

for d in apps/control-plane/dist apps/admin/dist apps/worker/dist; do
  [[ -d "$ATLAS_ROOT/$d" ]] || die "build output missing: $d"
done

# ── 5. Environment files (never overwritten) ──────────────────────────────
for svc in control-plane admin worker; do
  target="$ATLAS_ETC/${svc}.env"
  if [[ -f "$target" ]]; then
    log "Keeping existing ${target}"
  else
    install -o root -g "$ATLAS_USER" -m 0640 \
      "$ATLAS_ROOT/deploy/env/${svc}.env.example" "$target"
    warn "Created ${target} from template — fill it in before starting services."
  fi
done

# ── 6. systemd units ──────────────────────────────────────────────────────
log "Installing systemd units"
for unit in "${SERVICES[@]}"; do
  install -o root -g root -m 0644 \
    "$ATLAS_ROOT/deploy/systemd/${unit}.service" "/etc/systemd/system/${unit}.service"
done
systemctl daemon-reload

# ── 7. nginx on the Tailscale IP only ─────────────────────────────────────
TS_IP="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
if [[ -z "$TS_IP" ]]; then
  warn "No Tailscale IPv4 yet — skipping nginx. Run 'sudo tailscale up', then re-run."
else
  log "Configuring nginx on ${TS_IP}:8443"
  sed "s/__TAILSCALE_IP__/${TS_IP}/g" \
    "$ATLAS_ROOT/deploy/nginx/atlas-admin.conf" > /etc/nginx/sites-available/atlas-admin.conf
  ln -sf /etc/nginx/sites-available/atlas-admin.conf /etc/nginx/sites-enabled/atlas-admin.conf
  rm -f /etc/nginx/sites-enabled/default

  install -d -o root -g root -m 0755 /etc/nginx/snippets
  snippet="/etc/nginx/snippets/atlas-admin-auth.conf"
  if [[ -f "$snippet" ]]; then
    log "Keeping existing ${snippet}"
  else
    cat > "$snippet" <<'EOF'
# Replace __TOKEN__ with the ATLAS_CONTROL_PLANE_TOKEN value from
# /etc/atlas/admin.env, then: sudo nginx -t && sudo systemctl reload nginx
proxy_set_header Authorization "Bearer __TOKEN__";
EOF
    chmod 0600 "$snippet"
    warn "Created ${snippet} — replace __TOKEN__ before using the Owner UI."
  fi
  nginx -t
fi

# ── 8. Firewall — deny everything except Tailscale ────────────────────────
log "Applying firewall rules"
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow in on tailscale0 comment 'Atlas private plane'
ufw allow 41641/udp        comment 'Tailscale'
ufw --force enable
ufw status verbose

# ── 9. Report ─────────────────────────────────────────────────────────────
cat <<EOF

Bootstrap complete.

Services are installed but NOT started. Before starting:

  1. Fill in ${ATLAS_ETC}/control-plane.env, admin.env, worker.env
  2. Put the real token in /etc/nginx/snippets/atlas-admin-auth.conf
  3. sudo systemctl enable --now ${SERVICES[*]}
  4. sudo systemctl reload nginx
  5. sudo ${ATLAS_ROOT}/deploy/verify.sh

Owner UI (over Tailscale only): http://${TS_IP:-<tailscale-ip>}:8443/

Not deployed here by design: apps/web and apps/api live on Vercel (ADR-021).
EOF
