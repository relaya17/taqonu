#!/usr/bin/env bash
#
# Atlas private control plane — post-deployment verification.
#
# Read-only. Proves the private plane is running AND still private, and that
# the migration did not disturb the completed Atlas system.
#
# Runs deploy/validate-production-env.sh FIRST (static, pre-startup checks:
# file permissions/ownership, duplicate variables, token relationships,
# URL correctness) before any of the live/post-startup checks below, so a
# configuration problem is reported once, by the one script that owns that
# check, rather than re-implemented here.
#
# Usage:  sudo ./verify.sh
#
set -uo pipefail

ATLAS_ETC="/etc/atlas"
PASS=0
FAIL=0
SKIP=0

ok()   { printf '\033[1;32m  PASS\033[0m  %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '\033[1;31m  FAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL+1)); }
skip() { printf '\033[1;33m  SKIP\033[0m  %s\n' "$*"; SKIP=$((SKIP+1)); }
# Not named `head`: that would shadow /usr/bin/head, which this script pipes
# into when reading the Tailscale IP.
section() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null || echo 000; }

CP_TOKEN="$(grep -sE '^ATLAS_CONTROL_PLANE_TOKEN=' "$ATLAS_ETC/control-plane.env" | cut -d= -f2- || true)"

section "0. Static production environment validation (pre-startup)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="$SCRIPT_DIR/validate-production-env.sh"
if [[ -x "$VALIDATOR" ]]; then
  VALIDATE_RC=0
  "$VALIDATOR" || VALIDATE_RC=$?
  case "$VALIDATE_RC" in
    0) ok "deploy/validate-production-env.sh: READY (see full output above)" ;;
    1) bad "deploy/validate-production-env.sh: BLOCKED — a locally-fixable misconfiguration exists (see BLOCKED lines above)" ;;
    2) skip "deploy/validate-production-env.sh: REQUIRES OWNER INPUT — external values (Vercel/Supabase) are still missing (see OWNER lines above); this alone does not fail verify.sh, since it does not indicate the running services are misbehaving, only that some inputs are incomplete" ;;
    *) bad "deploy/validate-production-env.sh exited with unexpected code $VALIDATE_RC" ;;
  esac
else
  skip "deploy/validate-production-env.sh not found or not executable at $VALIDATOR"
fi

section "1. Runtime"
NODE_MAJOR="$(node -v 2>/dev/null | cut -c2- | cut -d. -f1 || echo 0)"
[[ "$NODE_MAJOR" -ge 22 ]] \
  && ok "Node $(node -v) meets engines >=22" \
  || bad "Node >=22 required, found $(node -v 2>/dev/null || echo none)"

section "2. Services"
for unit in atlas-control-plane atlas-admin atlas-worker; do
  systemctl is-active --quiet "$unit" \
    && ok "$unit active" \
    || bad "$unit not active — journalctl -u $unit -n 50"
done

section "3. Control Plane :3100"
[[ "$(code http://127.0.0.1:3100/api/v1/status)" == "200" ]] \
  && ok "liveness /api/v1/status returns 200 (public by design)" \
  || bad "liveness did not return 200"

UNAUTH="$(code http://127.0.0.1:3100/api/v1/agents)"
[[ "$UNAUTH" == "401" || "$UNAUTH" == "403" ]] \
  && ok "protected route rejects an unauthenticated call ($UNAUTH)" \
  || bad "protected route returned $UNAUTH — expected 401/403"

if [[ -n "$CP_TOKEN" ]]; then
  [[ "$(code -H "Authorization: Bearer $CP_TOKEN" http://127.0.0.1:3100/api/v1/agents)" == "200" ]] \
    && ok "protected route accepts the operator token" \
    || bad "operator token was rejected"
else
  skip "no ATLAS_CONTROL_PLANE_TOKEN in $ATLAS_ETC/control-plane.env"
fi

section "4. Owner Admin :3200"
# GET / is a promo page (200) by design. Privileged JSON is token-gated.
ADMIN_UNAUTH="$(code http://127.0.0.1:3200/api/v1/platform/hierarchy)"
[[ "$ADMIN_UNAUTH" == "401" || "$ADMIN_UNAUTH" == "503" ]] \
  && ok "Admin hierarchy rejects a token-less request ($ADMIN_UNAUTH)" \
  || bad "Admin hierarchy returned $ADMIN_UNAUTH — expected 401 (token set) or 503 (token missing)"

if [[ -n "$CP_TOKEN" ]]; then
  [[ "$(code -H "Authorization: Bearer $CP_TOKEN" http://127.0.0.1:3200/)" == "200" ]] \
    && ok "Admin serves the Owner UI with a valid bearer token" \
    || bad "Admin did not return 200 with a valid token"
else
  skip "cannot test the authenticated path without a token"
fi

section "5. Private-by-default (ADR-021)"
for port in 3100 3200; do
  # Extract ONLY the local-address:port field -- never grep the whole `ss`
  # line. ss always prints the generic peer-address placeholder
  # "0.0.0.0:*" for every LISTEN socket regardless of what it is actually
  # bound to, which previously made this false-positive "public interface"
  # on a correctly loopback-only listener (same root cause as the nginx
  # :8443 bug already fixed in reconcile-production-vm.sh). Picking the
  # first whitespace-separated field that contains a colon works
  # regardless of exactly how many columns ss prints.
  PORT_LOCAL_ADDR="$(ss -ltnH "sport = :$port" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i ~ /:/) {print $i; exit}}' | head -n1)"
  if [[ -z "$PORT_LOCAL_ADDR" ]]; then
    bad "nothing is listening on port $port"
  elif [[ "$PORT_LOCAL_ADDR" == 0.0.0.0:* || "$PORT_LOCAL_ADDR" == \[::\]:* ]]; then
    bad "port $port is bound to a public interface ($PORT_LOCAL_ADDR)"
  elif [[ "$PORT_LOCAL_ADDR" == 127.0.0.1:* ]]; then
    ok "port $port is loopback-only"
  else
    bad "port $port is bound to an unexpected address ($PORT_LOCAL_ADDR) -- neither loopback nor a public pattern. Review manually."
  fi
done

ufw status verbose 2>/dev/null | grep -q 'Default: deny (incoming)' \
  && ok "firewall denies all inbound by default" \
  || bad "firewall default is not deny-incoming"

TS_IP="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
if [[ -n "$TS_IP" ]]; then
  if ss -ltnH "sport = :8443" 2>/dev/null | grep -q "$TS_IP"; then
    ok "nginx listens on the Tailscale IP only ($TS_IP:8443)"
  elif ss -ltnH "sport = :8443" 2>/dev/null | grep -qE '0\.0\.0\.0:|\[::\]:'; then
    bad "nginx is bound to a public interface on :8443"
  else
    bad "nothing is listening on :8443"
  fi
else
  skip "Tailscale IPv4 not available"
fi

# NOTE: env-file permission/ownership checks used to be re-implemented here.
# They are now covered by deploy/validate-production-env.sh in section "0."
# above (which also checks ownership, not just mode, plus duplicates and
# token relationships that this loop never could) — removed from here to
# avoid two sources of truth for the same check.

# packages/config loads /opt/atlas/.env (override:false) and then
# /opt/atlas/apps/api/.env with override:TRUE. A stray file at either path
# silently outranks systemd's EnvironmentFile, so a service could end up
# running with NODE_ENV=development and someone else's secrets.
STRAY=""
for f in /opt/atlas/.env /opt/atlas/apps/api/.env; do
  [[ -f "$f" ]] && STRAY="$STRAY $f"
done
[[ -z "$STRAY" ]] \
  && ok "no stray .env in the checkout to override EnvironmentFile" \
  || bad "stray dotenv outranks systemd:$STRAY"

section "6. Completed system left undisturbed"
if [[ -n "$CP_TOKEN" ]]; then
  PROJ="$(curl -s --max-time 10 -H "Authorization: Bearer $CP_TOKEN" \
    http://127.0.0.1:3100/api/v1/agents/fabric-projection 2>/dev/null || true)"
  COUNT="$(printf '%s' "$PROJ" | grep -o '"agentId"' | wc -l | tr -d ' ')"
  [[ "$COUNT" == "16" ]] \
    && ok "Fabric projection still exposes 16 agents" \
    || bad "Fabric projection reported $COUNT agents — expected 16"

  GOV="$(curl -s --max-time 10 -H "Authorization: Bearer $CP_TOKEN" \
    http://127.0.0.1:3100/api/v1/portfolio-governance 2>/dev/null || true)"
  # The Control Plane pretty-prints (JSON.stringify(data, null, 2)), so the
  # colon is followed by a space. Match either form.
  printf '%s' "$GOV" | grep -qE '"ingestEnabled":[[:space:]]*false' \
    && ok "Portfolio safety lock ingestEnabled is still false" \
    || bad "could not confirm ingestEnabled=false in the Portfolio view"
else
  skip "invariant checks need the operator token"
fi

section "Result"
printf '  %d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
[[ "$FAIL" -eq 0 ]] || exit 1
echo "  Private plane verified. The old Vercel Admin URLs may now be paused."
