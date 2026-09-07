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
# Pipeline: packages -> service account -> source -> build -> env files ->
# auto-fill safely-generatable secrets (never rotates) -> systemd units ->
# nginx (validate, never reload here) -> firewall -> explicit startup gate
# (deploy/validate-production-env.sh — READY / BLOCKED / REQUIRES OWNER
# INPUT). Services are left stopped either way; starting them is always a
# separate, explicit step reported at the end.
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
  # iproute2 provides `ss`, which verify.sh uses to prove the listeners are
  # loopback-only. Present on standard images, absent on some minimal ones.
  apt-get install -y -qq curl git ufw nginx ca-certificates gnupg iproute2

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

# ── 5b. Auto-fill safely-generatable secrets (never rotates) ──────────────
# Control Plane's operator/owner tokens and the worker's ENCRYPTION_KEY /
# COOKIE_SECRET are values Atlas itself can generate securely (openssl rand)
# — there is no reason to make an operator hand-type them with nano. Values
# that must come from an external system (WEB_ORIGIN, ATLAS_API_URL,
# Supabase credentials) are never touched here; deploy/generate-tokens.sh
# only ever fills a line that is present and empty, and never overwrites an
# existing value, so this is safe to run on every bootstrap/--update pass,
# including against an already-configured install (always a no-op there).
log "Auto-filling safely-generatable secrets (control-plane tokens, worker crypto keys)"
if ! "$ATLAS_ROOT/deploy/generate-tokens.sh" \
    "$ATLAS_ETC/control-plane.env" "$ATLAS_ETC/admin.env" "$ATLAS_ETC/worker.env"; then
  warn "deploy/generate-tokens.sh reported one or more problems (see above) — these need manual attention (e.g. a duplicate or missing variable line) before services can start. The validation gate at the end of this script restates what's left."
fi

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
  # Validate BEFORE this script (or the operator) ever reloads nginx.
  # Deliberately does NOT call `systemctl reload nginx` itself anywhere —
  # reload stays an explicit, separate operator step (reported below) that
  # only happens after `nginx -t` has already passed here.
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

# ── 9. Explicit startup gate ───────────────────────────────────────────────
# Services are never started by this script. This is the single authoritative
# READY / BLOCKED / REQUIRES OWNER INPUT signal an operator needs before
# deciding whether `systemctl enable --now` is safe to run.
log "Running production environment validation (deploy/validate-production-env.sh)"
VALIDATE_RC=0
"$ATLAS_ROOT/deploy/validate-production-env.sh" \
  "$ATLAS_ETC/control-plane.env" "$ATLAS_ETC/admin.env" "$ATLAS_ETC/worker.env" \
  || VALIDATE_RC=$?

cat <<EOF

Bootstrap complete. Services are installed but NOT started.
EOF

case "$VALIDATE_RC" in
  0)
    cat <<EOF

VERDICT: READY — every check above passed. To start:

  1. Put the current ATLAS_CONTROL_PLANE_TOKEN value from
     ${ATLAS_ETC}/control-plane.env into
     /etc/nginx/snippets/atlas-admin-auth.conf (replace __TOKEN__ — this one
     file is nginx config, not a service env file, so generate-tokens.sh
     deliberately does not touch it)
  2. sudo nginx -t && sudo systemctl reload nginx
  3. sudo systemctl enable --now ${SERVICES[*]}
  4. sudo ${ATLAS_ROOT}/deploy/verify.sh
EOF
    ;;
  1)
    cat <<EOF

VERDICT: BLOCKED — one or more locally-fixable misconfigurations exist (see
the BLOCKED lines in the validation output above: duplicate variables, bad
file permissions, mismatched or identical tokens, a malformed or loopback
URL where a public one is required). None of these need external input. Fix
them, then re-run:
  sudo ${ATLAS_ROOT}/deploy/validate-production-env.sh
EOF
    ;;
  2)
    cat <<EOF

VERDICT: REQUIRES OWNER INPUT — everything locally checkable is correct. The
remaining gaps (see OWNER lines above) are external values this script
cannot generate or guess — typically WEB_ORIGIN and ATLAS_API_URL (the real
production apps/web and apps/api URLs on Vercel) and the Supabase
credentials. Fill those into ${ATLAS_ETC}/control-plane.env and
${ATLAS_ETC}/worker.env, then re-run:
  sudo ${ATLAS_ROOT}/deploy/validate-production-env.sh
EOF
    ;;
  *)
    warn "deploy/validate-production-env.sh exited with unexpected code $VALIDATE_RC — treat as BLOCKED and investigate before starting services."
    ;;
esac

cat <<EOF

Owner UI (over Tailscale only, once started): http://${TS_IP:-<tailscale-ip>}:8443/

Not deployed here by design: apps/web and apps/api live on Vercel (ADR-021).
EOF
