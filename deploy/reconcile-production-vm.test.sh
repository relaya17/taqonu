#!/usr/bin/env bash
#
# Fixture-based test suite for deploy/reconcile-production-vm.sh.
#
# Entirely self-contained: builds a disposable scratch repository, scratch
# /etc/atlas, and stub nginx/tailscale/ufw/ss/systemctl executables under a
# temp directory, then exercises reconcile-production-vm.sh against them via
# its ATLAS_ROOT / ATLAS_ETC / SYSTEMD_DIR / NGINX_SNIPPET / NGINX_SITE /
# BACKUP_ROOT / EXPECTED_COMMIT overrides and RECONCILE_SKIP_ROOT_CHECK=1.
# Never touches the real system. No real secrets anywhere -- every "token"
# below is an obvious disposable fixture string.
#
# Usage: bash deploy/reconcile-production-vm.test.sh
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/reconcile-production-vm.sh"
VALIDATOR_SRC="$SCRIPT_DIR/validate-production-env.sh"
GEN_TOKENS_SRC="$SCRIPT_DIR/generate-tokens.sh"

WORK="$(mktemp -d /tmp/rvm-test.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

STUB_BIN="$WORK/bin"
SCRATCH_ROOT="$WORK/scratch"
mkdir -p "$STUB_BIN" "$SCRATCH_ROOT"

PASS_COUNT=0
FAIL_COUNT=0
FAILED_NAMES=()

# ---------------------------------------------------------------------------
# Stub binaries -- behavior driven entirely by files under $STUB_STATE so
# each scenario can toggle them without editing the stubs themselves.
# ---------------------------------------------------------------------------
cat > "$STUB_BIN/nginx" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "-t" ]]; then
  code="$(cat "$STUB_STATE/nginx_t_exit" 2>/dev/null || echo 0)"
  echo "nginx: the configuration file /etc/nginx/nginx.conf syntax is ok (stub, rc=$code)"
  exit "$code"
fi
exit 0
EOF
cat > "$STUB_BIN/tailscale" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  ip)
    ip="$(cat "$STUB_STATE/tailscale_ip" 2>/dev/null || echo "")"
    [[ -n "$ip" ]] && echo "$ip"
    exit 0
    ;;
  status)
    ip="$(cat "$STUB_STATE/tailscale_ip" 2>/dev/null || echo "100.64.0.5")"
    echo "$ip   stub-host   linux   -"
    exit 0
    ;;
  *) exit 0 ;;
esac
EOF
cat > "$STUB_BIN/ufw" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "status" ]]; then
  d="$(cat "$STUB_STATE/ufw_deny" 2>/dev/null || echo yes)"
  echo "Status: active"
  if [[ "$d" == "yes" ]]; then
    echo "Default: deny (incoming), allow (outgoing), disabled (routed)"
  else
    echo "Default: allow (incoming), allow (outgoing), disabled (routed)"
  fi
  exit 0
fi
exit 0
EOF
cat > "$STUB_BIN/ss" <<'EOF'
#!/usr/bin/env bash
port=""
for a in "$@"; do
  if [[ "$a" =~ sport\ =\ :([0-9]+) ]]; then
    port="${BASH_REMATCH[1]}"
  fi
done
[[ -f "$STUB_STATE/listeners" ]] || exit 0
grep -E ":${port}\$| :${port}\$|:${port} " "$STUB_STATE/listeners" 2>/dev/null || true
exit 0
EOF
cat > "$STUB_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
cmd="$1"; shift || true
case "$cmd" in
  is-active)
    unit="${*: -1}"
    active="$(cat "$STUB_STATE/systemctl_active" 2>/dev/null || true)"
    if printf '%s\n' "$active" | grep -qx "$unit"; then
      echo active; exit 0
    else
      echo inactive; exit 3
    fi
    ;;
  enable)
    unit="${*: -1}"
    failset="$(cat "$STUB_STATE/systemctl_start_fail" 2>/dev/null || true)"
    if printf '%s\n' "$failset" | grep -qx "$unit"; then
      exit 1
    fi
    echo "$unit" >> "$STUB_STATE/systemctl_active"
    exit 0
    ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$STUB_BIN"/*

# Minimal stand-in for @atlas/config's loadServerEnv() -- exercises this
# script's interpretation of the validator's exit code / OWNER-BLOCKED
# output, NOT a re-test of loadServerEnv()'s own secret rules (that lives in
# packages/config's own test suite).
cat > "$WORK/fake-config-index.js" <<'EOF'
export function loadServerEnv(env, _opts) {
  const required = ["DATABASE_URL", "ENCRYPTION_KEY", "COOKIE_SECRET"];
  for (const k of required) {
    if (!env[k]) throw new Error(`${k} is required in production`);
  }
  if (env.ENCRYPTION_KEY.length < 32) throw new Error("ENCRYPTION_KEY must be at least 32 characters");
  if (env.COOKIE_SECRET.length < 32) throw new Error("COOKIE_SECRET must be at least 32 characters");
  const placeholder = "12345678901234567890123456789012";
  if (env.ENCRYPTION_KEY === placeholder || env.COOKIE_SECRET === placeholder) {
    throw new Error("secret must not be the documented example placeholder");
  }
  if (env.ATLAS_FAKE_EMIT_WARNING === "1") {
    process.stderr.write("(node:12345) ExperimentalWarning: fake warning for test coverage\n");
  }
  return true;
}
EOF

build_baseline() {
  local d="$1"
  rm -rf "$d"
  mkdir -p "$d/root" "$d/etc" "$d/systemd" "$d/nginx" "$d/backups" "$d/stub-state"

  ( cd "$d/root" && git init -q && git config user.email t@example.com && git config user.name test )
  mkdir -p "$d/root/deploy/systemd"
  cp "$VALIDATOR_SRC" "$d/root/deploy/validate-production-env.sh"
  cp "$GEN_TOKENS_SRC" "$d/root/deploy/generate-tokens.sh"
  chmod +x "$d/root/deploy/validate-production-env.sh" "$d/root/deploy/generate-tokens.sh"

  for u in atlas-control-plane atlas-admin atlas-worker; do
    cat > "$d/root/deploy/systemd/${u}.service" <<EOF
[Unit]
Description=$u (fixture)
[Service]
EnvironmentFile=/etc/atlas/${u#atlas-}.env
WorkingDirectory=/opt/atlas
ExecStart=/usr/bin/node dist/index.js
[Install]
WantedBy=multi-user.target
EOF
  done

  mkdir -p "$d/root/packages/config"
  printf '{"type":"module"}\n' > "$d/root/packages/config/package.json"
  printf 'dist/\n**/dist/\n' > "$d/root/.gitignore"

  ( cd "$d/root" && git add -A && git commit -q -m "fixture baseline" )
  ( cd "$d/root" && git rev-parse HEAD ) > "$d/expected_commit"

  mkdir -p "$d/root/packages/config/dist"
  cp "$WORK/fake-config-index.js" "$d/root/packages/config/dist/index.js"
  for app in control-plane admin worker; do
    mkdir -p "$d/root/apps/$app/dist"
    echo "// fixture build artifact" > "$d/root/apps/$app/dist/index.js"
  done

  cat > "$d/etc/control-plane.env" <<'EOF'
NODE_ENV=production
CONTROL_PLANE_PORT=3100
HOST=127.0.0.1
ATLAS_CONTROL_PLANE_TOKEN=operatortoken000000000000000000
ATLAS_CONTROL_PLANE_OWNER_TOKEN=ownertoken111111111111111111111
WEB_ORIGIN=https://app.example.com
ATLAS_API_URL=https://api.example.com
ATLAS_CP_AUDIT_SYNC=1
EOF
  cat > "$d/etc/admin.env" <<'EOF'
NODE_ENV=production
ADMIN_PORT=3200
HOST=127.0.0.1
ATLAS_CONTROL_PLANE_URL=http://127.0.0.1:3100
ATLAS_CONTROL_PLANE_TOKEN=operatortoken000000000000000000
EOF
  cat > "$d/etc/worker.env" <<'EOF'
NODE_ENV=production
DATABASE_URL=postgres://user:pass@db.example.com/atlas
ENCRYPTION_KEY=abcdefghijklmnopqrstuvwxyz012345
COOKIE_SECRET=zyxwvutsrqponmlkjihgfedcba987654
ATLAS_QUEUE_PATH=/var/lib/atlas/worker-queue.json
ATLAS_REPO_ROOT=/opt/atlas
EOF
  chown root:atlas "$d/etc/control-plane.env" "$d/etc/admin.env" "$d/etc/worker.env" 2>/dev/null || true
  chmod 0640 "$d/etc/control-plane.env" "$d/etc/admin.env" "$d/etc/worker.env"

  cat > "$d/nginx/site.conf" <<'EOF'
server {
  listen 100.64.0.5:8443 ssl;
  server_name atlas-admin.internal;
  location / {
    proxy_pass http://127.0.0.1:3200;
  }
}
EOF
  cat > "$d/nginx/snippet.conf" <<'EOF'
proxy_set_header Authorization "Bearer operatortoken000000000000000000";
EOF

  cp "$d/root/deploy/systemd/atlas-control-plane.service" "$d/systemd/atlas-control-plane.service"
  cp "$d/root/deploy/systemd/atlas-admin.service" "$d/systemd/atlas-admin.service"
  cp "$d/root/deploy/systemd/atlas-worker.service" "$d/systemd/atlas-worker.service"

  echo 0 > "$d/stub-state/nginx_t_exit"
  echo "100.64.0.5" > "$d/stub-state/tailscale_ip"
  echo "yes" > "$d/stub-state/ufw_deny"
  cat > "$d/stub-state/listeners" <<'EOF'
127.0.0.1:3100
127.0.0.1:3200
100.64.0.5:8443
EOF
  : > "$d/stub-state/systemctl_active"
  : > "$d/stub-state/systemctl_start_fail"
}

run_script() {
  local d="$1"
  shift
  local expected_commit
  expected_commit="$(cat "$d/expected_commit" 2>/dev/null || echo 0000000000000000000000000000000000000000)"
  PATH="$STUB_BIN:$PATH" \
  STUB_STATE="$d/stub-state" \
  ATLAS_ROOT="$d/root" \
  ATLAS_ETC="$d/etc" \
  SYSTEMD_DIR="$d/systemd" \
  NGINX_SNIPPET="$d/nginx/snippet.conf" \
  NGINX_SITE="$d/nginx/site.conf" \
  BACKUP_ROOT="$d/backups" \
  EXPECTED_COMMIT="$expected_commit" \
  RECONCILE_SKIP_ROOT_CHECK=1 \
  ATLAS_VALIDATE_SKIP_OWNERSHIP=1 \
  bash "$SCRIPT_UNDER_TEST" "$@" 2>&1
}

check_case() {
  local name="$1" rc="$2" expected_rc="$3" expected_overall="$4" out="$5"
  local ok=1 overall
  if [[ "$rc" != "$expected_rc" ]]; then
    echo "  [FAIL] $name: exit code $rc, expected $expected_rc"; ok=0
  fi
  overall="$(printf '%s\n' "$out" | grep -oE '^OVERALL_STATUS=.*' | tail -n1 | cut -d= -f2-)"
  if [[ -n "$expected_overall" && "$overall" != "$expected_overall" ]]; then
    echo "  [FAIL] $name: OVERALL_STATUS=$overall, expected $expected_overall"; ok=0
  fi
  if [[ "$ok" -eq 1 ]]; then
    PASS_COUNT=$((PASS_COUNT+1)); echo "  [ OK ] $name (rc=$rc, OVERALL_STATUS=$overall)"
  else
    FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_NAMES+=("$name")
    printf '%s\n' "$out" | sed 's/^/         /' | tail -n 20
  fi
}

assert_contains() {
  local out="$1" needle="$2" what="$3"
  if printf '%s\n' "$out" | grep -qF "$needle"; then return 0; fi
  echo "    MISSING: '$needle' ($what)"
  FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_NAMES+=("$what")
  return 1
}

# =====================================================================
echo "1. Clean repository, fully valid -> READY_FOR_START"
D="$SCRATCH_ROOT/01"; build_baseline "$D"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "clean-repo-ready" "$RC" 0 "READY_FOR_START" "$OUT"

echo "2. Dirty repository -> BLOCKED, no mutation attempted"
D="$SCRATCH_ROOT/02"; build_baseline "$D"
echo "// local edit" >> "$D/root/deploy/generate-tokens.sh"
OUT="$(run_script "$D" --repair)"; RC=$?
check_case "dirty-repo-blocks" "$RC" 1 "BLOCKED" "$OUT"
assert_contains "$OUT" "safe repair skipped entirely -- repository gate did not pass" "dirty-repair-skipped"

echo "3. Divergent repository -> BLOCKED, no mutation attempted"
D="$SCRATCH_ROOT/03"; build_baseline "$D"
echo "0000000000000000000000000000000000000000" > "$D/expected_commit"
OUT="$(run_script "$D" --repair)"; RC=$?
check_case "divergent-repo-blocks" "$RC" 1 "BLOCKED" "$OUT"

echo "4. Missing repository -> REPAIR_REQUIRED"
D="$SCRATCH_ROOT/04"; build_baseline "$D"
rm -rf "$D/root/.git"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "missing-repo" "$RC" 3 "REPAIR_REQUIRED" "$OUT"

echo "5. Missing WEB_ORIGIN -> REQUIRES_OWNER_INPUT + MISSING_VARIABLE"
D="$SCRATCH_ROOT/05"; build_baseline "$D"
sed -i '/^WEB_ORIGIN=/d' "$D/etc/control-plane.env"; echo "WEB_ORIGIN=" >> "$D/etc/control-plane.env"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "missing-web-origin" "$RC" 2 "REQUIRES_OWNER_INPUT" "$OUT"
assert_contains "$OUT" "MISSING_VARIABLE=WEB_ORIGIN" "missing-web-origin-var"

echo "6. Missing ATLAS_API_URL -> REQUIRES_OWNER_INPUT"
D="$SCRATCH_ROOT/06"; build_baseline "$D"
sed -i '/^ATLAS_API_URL=/d' "$D/etc/control-plane.env"; echo "ATLAS_API_URL=" >> "$D/etc/control-plane.env"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "missing-api-url" "$RC" 2 "REQUIRES_OWNER_INPUT" "$OUT"

echo "7. Loopback ATLAS_API_URL -> BLOCKED"
D="$SCRATCH_ROOT/07"; build_baseline "$D"
sed -i 's#^ATLAS_API_URL=.*#ATLAS_API_URL=http://127.0.0.1:3100#' "$D/etc/control-plane.env"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "loopback-api-url" "$RC" 1 "BLOCKED" "$OUT"

echo "8. Duplicate env var -> BLOCKED"
D="$SCRATCH_ROOT/08"; build_baseline "$D"
echo "ATLAS_CONTROL_PLANE_TOKEN=someotherduplicatevalueforcheck" >> "$D/etc/control-plane.env"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "duplicate-var" "$RC" 1 "BLOCKED" "$OUT"

echo "9. Operator/owner token identical -> BLOCKED"
D="$SCRATCH_ROOT/09"; build_baseline "$D"
sed -i 's#^ATLAS_CONTROL_PLANE_OWNER_TOKEN=.*#ATLAS_CONTROL_PLANE_OWNER_TOKEN=operatortoken000000000000000000#' "$D/etc/control-plane.env"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "operator-owner-identical" "$RC" 1 "BLOCKED" "$OUT"

echo "10. Admin/operator token mismatch -> BLOCKED"
D="$SCRATCH_ROOT/10"; build_baseline "$D"
sed -i 's#^ATLAS_CONTROL_PLANE_TOKEN=.*#ATLAS_CONTROL_PLANE_TOKEN=totallydifferenttokenvalueherexx#' "$D/etc/admin.env"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "admin-operator-mismatch" "$RC" 1 "BLOCKED" "$OUT"

echo "11. Missing tokens -> --repair generates them, no value leaked"
D="$SCRATCH_ROOT/11"; build_baseline "$D"
sed -i 's#^ATLAS_CONTROL_PLANE_TOKEN=.*#ATLAS_CONTROL_PLANE_TOKEN=#' "$D/etc/control-plane.env"
sed -i 's#^ATLAS_CONTROL_PLANE_OWNER_TOKEN=.*#ATLAS_CONTROL_PLANE_OWNER_TOKEN=#' "$D/etc/control-plane.env"
sed -i 's#^ATLAS_CONTROL_PLANE_TOKEN=.*#ATLAS_CONTROL_PLANE_TOKEN=#' "$D/etc/admin.env"
OUT="$(run_script "$D" --repair)"; RC=$?
check_case "missing-tokens-repair" "$RC" 1 "BLOCKED" "$OUT"
assert_contains "$OUT" "TOKEN_ACTION=GENERATE_MISSING" "missing-tokens-action"
NEWTOK="$(grep '^ATLAS_CONTROL_PLANE_TOKEN=' "$D/etc/control-plane.env" | cut -d= -f2-)"
if [[ -n "$NEWTOK" ]] && ! printf '%s' "$OUT" | grep -qF "$NEWTOK"; then
  PASS_COUNT=$((PASS_COUNT+1)); echo "  [ OK ] missing-tokens-no-leak"
else
  FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_NAMES+=("missing-tokens-no-leak"); echo "  [FAIL] missing-tokens-no-leak"
fi

echo "12. --check never mutates, even with missing tokens"
D="$SCRATCH_ROOT/12"; build_baseline "$D"
sed -i 's#^ATLAS_CONTROL_PLANE_TOKEN=.*#ATLAS_CONTROL_PLANE_TOKEN=#' "$D/etc/control-plane.env"
BEFORE="$(sha256sum "$D/etc"/*.env)"
OUT="$(run_script "$D" --check)"; RC=$?
AFTER="$(sha256sum "$D/etc"/*.env)"
if [[ "$BEFORE" == "$AFTER" ]]; then
  PASS_COUNT=$((PASS_COUNT+1)); echo "  [ OK ] check-mode-no-mutation"
else
  FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_NAMES+=("check-mode-no-mutation"); echo "  [FAIL] check-mode-no-mutation"
fi

echo "13. Checker not executable (repo otherwise clean) -> REPAIR_REQUIRED"
D="$SCRATCH_ROOT/13"; build_baseline "$D"
chmod -x "$D/root/deploy/validate-production-env.sh"
( cd "$D/root" && git commit -q -am "test: make validator non-executable" )
( cd "$D/root" && git rev-parse HEAD ) > "$D/expected_commit"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "checker-not-executable" "$RC" 3 "REPAIR_REQUIRED" "$OUT"
assert_contains "$OUT" "CHECKER_EXECUTION_FAILED" "checker-error-code"

echo "14. Node stderr warning during worker delegation is tolerated"
D="$SCRATCH_ROOT/14"; build_baseline "$D"
echo "ATLAS_FAKE_EMIT_WARNING=1" >> "$D/etc/worker.env"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "node-warning-tolerated" "$RC" 0 "READY_FOR_START" "$OUT"

echo "15. nginx -t failure -> BLOCKED"
D="$SCRATCH_ROOT/15"; build_baseline "$D"
echo 1 > "$D/stub-state/nginx_t_exit"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "nginx-t-fails" "$RC" 1 "BLOCKED" "$OUT"

echo "16. Inactive-but-expected services under --check -> still READY"
D="$SCRATCH_ROOT/16"; build_baseline "$D"
: > "$D/stub-state/listeners"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "inactive-expected" "$RC" 0 "READY_FOR_START" "$OUT"
assert_contains "$OUT" "NGINX_LISTENER_STATUS=EXPECTED_INACTIVE" "listener-expected-inactive"

echo "17. Same missing listener under --start -> FAIL, not silent PASS"
D="$SCRATCH_ROOT/17"; build_baseline "$D"
: > "$D/stub-state/listeners"
OUT="$(run_script "$D" --start)"; RC=$?
check_case "start-missing-listener" "$RC" 1 "BLOCKED" "$OUT"
assert_contains "$OUT" "NGINX_LISTENER_STATUS=FAIL" "listener-fail-under-start"

echo "18. Missing build artifacts -> BLOCKED"
D="$SCRATCH_ROOT/18"; build_baseline "$D"
rm -rf "$D/root/apps/worker/dist"
OUT="$(run_script "$D" --check)"; RC=$?
check_case "missing-build-artifact" "$RC" 1 "BLOCKED" "$OUT"

echo "19. Idempotency: second identical --repair run changes nothing further"
D="$SCRATCH_ROOT/19"; build_baseline "$D"
sed -i 's#^ATLAS_CONTROL_PLANE_TOKEN=.*#ATLAS_CONTROL_PLANE_TOKEN=#' "$D/etc/control-plane.env"
run_script "$D" --repair >/dev/null
SUM1="$(sha256sum "$D/etc"/*.env)"
OUT2="$(run_script "$D" --repair)"
SUM2="$(sha256sum "$D/etc"/*.env)"
if [[ "$SUM1" == "$SUM2" ]]; then
  PASS_COUNT=$((PASS_COUNT+1)); echo "  [ OK ] idempotent-second-run"
else
  FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_NAMES+=("idempotent-second-run"); echo "  [FAIL] idempotent-second-run"
fi
assert_contains "$OUT2" "TOKEN_ACTION=KEEP_EXISTING" "idempotent-keep-existing"

echo "20. Mode flags never combine -> usage error"
D="$SCRATCH_ROOT/20"; build_baseline "$D"
OUT="$(run_script "$D" --check --repair)"; RC=$?
check_case "mode-flags-exclusive" "$RC" 64 "" "$OUT"
assert_contains "$OUT" "more than one mode flag given" "mode-flags-message"

echo "21. Full readiness -> --start actually starts services in order"
D="$SCRATCH_ROOT/21"; build_baseline "$D"
OUT="$(run_script "$D" --start)"; RC=$?
check_case "start-success" "$RC" 0 "READY_FOR_START" "$OUT"

echo "22. Service fails mid-sequence -> stops, does not attempt the rest"
D="$SCRATCH_ROOT/22"; build_baseline "$D"
echo "atlas-admin" > "$D/stub-state/systemctl_start_fail"
OUT="$(run_script "$D" --start)"; RC=$?
check_case "start-mid-failure" "$RC" 1 "BLOCKED" "$OUT"
if printf '%s' "$OUT" | grep -q "atlas-worker is active"; then
  FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_NAMES+=("start-stops-on-failure"); echo "  [FAIL] start-stops-on-failure"
else
  PASS_COUNT=$((PASS_COUNT+1)); echo "  [ OK ] start-stops-on-failure"
fi

echo "23. --start refuses to run when STARTUP_READINESS is not PASS"
D="$SCRATCH_ROOT/23"; build_baseline "$D"
sed -i '/^WEB_ORIGIN=/d' "$D/etc/control-plane.env"; echo "WEB_ORIGIN=" >> "$D/etc/control-plane.env"
OUT="$(run_script "$D" --start)"; RC=$?
check_case "start-refused-not-ready" "$RC" 2 "" "$OUT"
assert_contains "$OUT" "Refusing to start services" "start-refusal-message"

echo "24. Backup manifest is non-secret, valid JSON, root-only"
D="$SCRATCH_ROOT/24"; build_baseline "$D"
run_script "$D" --repair >/dev/null
MANIFEST="$(find "$D/backups" -name manifest.json | head -n1)"
if [[ -n "$MANIFEST" ]] && python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$MANIFEST" 2>/dev/null \
   && ! grep -qE 'operatortoken000000000000000000|ownertoken111111111111111111111' "$MANIFEST" \
   && [[ "$(stat -c '%a' "$(dirname "$MANIFEST")")" == "700" ]]; then
  PASS_COUNT=$((PASS_COUNT+1)); echo "  [ OK ] backup-manifest-well-formed"
else
  FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_NAMES+=("backup-manifest-well-formed"); echo "  [FAIL] backup-manifest-well-formed"
fi

echo "25. No secret value ever appears in a --repair run's output"
D="$SCRATCH_ROOT/25"; build_baseline "$D"
OUT="$(run_script "$D" --repair)"
LEAK=0
for secret in operatortoken000000000000000000 ownertoken111111111111111111111 abcdefghijklmnopqrstuvwxyz012345 zyxwvutsrqponmlkjihgfedcba987654; do
  printf '%s' "$OUT" | grep -qF "$secret" && LEAK=1
done
if [[ "$LEAK" -eq 0 ]]; then
  PASS_COUNT=$((PASS_COUNT+1)); echo "  [ OK ] no-secret-leak"
else
  FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_NAMES+=("no-secret-leak"); echo "  [FAIL] no-secret-leak"
fi

echo
echo "RESULT: $PASS_COUNT passed, $FAIL_COUNT failed"
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "Failed: ${FAILED_NAMES[*]}"
  exit 1
fi
exit 0
