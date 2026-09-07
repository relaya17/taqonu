#!/usr/bin/env bash
#
# Self-test harness for deploy/validate-production-env.sh.
#
# Exercises the validator against disposable, clearly-fake fixture env files
# (never real production secrets) and asserts the exit code / verdict each
# case must produce. Run this after any change to
# deploy/validate-production-env.sh, and as part of the commit-policy
# verification sequence in section 18 of the deployment repair directive.
#
# Usage:
#   ./deploy/validate-production-env.test.sh
#
# Exit code: 0 if every case passed, 1 if any case failed (prints which).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="$SCRIPT_DIR/validate-production-env.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -x "$VALIDATOR" ]]; then
  echo "FAIL: $VALIDATOR not found or not executable" >&2
  exit 1
fi

WORK="$(mktemp -d /tmp/atlas-validate-test.XXXXXX)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

PASS=0
FAIL=0

# ---------------------------------------------------------------------------
# Base fixtures. All secret-shaped values below are synthetic test fixtures
# (clearly non-production, generated for this test run) -- never real
# credentials, and never committed anywhere but this disposable $WORK dir.
# ---------------------------------------------------------------------------
OPERATOR_TOKEN="test_operator_token_1111111111111111111111"
OWNER_TOKEN="test_owner_token_2222222222222222222222222"

write_cp() { # write a fresh, valid control-plane.env fixture to $1, then apply sed edits from $2..
  local out="$1"; shift
  cat > "$out" <<EOF
NODE_ENV=production
CONTROL_PLANE_PORT=3100
HOST=127.0.0.1
ATLAS_CONTROL_PLANE_TOKEN=$OPERATOR_TOKEN
ATLAS_CONTROL_PLANE_OWNER_TOKEN=$OWNER_TOKEN
WEB_ORIGIN=https://example-web.vercel.app
ATLAS_API_URL=https://example-api.vercel.app
ATLAS_CP_AUDIT_SYNC=1
EOF
  for expr in "$@"; do sed -i "$expr" "$out"; done
  chmod 600 "$out"
}

write_admin() {
  local out="$1"; shift
  cat > "$out" <<EOF
NODE_ENV=production
ADMIN_PORT=3200
HOST=127.0.0.1
ATLAS_CONTROL_PLANE_URL=http://127.0.0.1:3100
ATLAS_CONTROL_PLANE_TOKEN=$OPERATOR_TOKEN
EOF
  for expr in "$@"; do sed -i "$expr" "$out"; done
  chmod 600 "$out"
}

write_worker() {
  local out="$1"; shift
  cat > "$out" <<EOF
NODE_ENV=production
DATABASE_URL=postgres://test-fixture:test-fixture@localhost:5432/test_fixture_db
SUPABASE_URL=https://test-fixture-project.supabase.co
SUPABASE_ANON_KEY=test_fixture_anon_key_not_real
SUPABASE_SERVICE_ROLE_KEY=test_fixture_service_role_key_not_real
ENCRYPTION_KEY=test_fixture_encryption_key_32ch
COOKIE_SECRET=test_fixture_cookie_secret_32chr
ATLAS_QUEUE_PATH=/var/lib/atlas/worker-queue.json
ATLAS_REPO_ROOT=/opt/atlas
EOF
  for expr in "$@"; do sed -i "$expr" "$out"; done
  chmod 600 "$out"
}

# All three cases run with ownership checks skipped (this harness does not
# run as root and does not need to -- permission-mode checks still run) and
# ATLAS_ROOT pointed at the real, already-built monorepo checkout so the
# worker section delegates to the actual @atlas/config loadServerEnv(), not
# a stand-in.
export ATLAS_VALIDATE_SKIP_OWNERSHIP=1
export ATLAS_ROOT="$REPO_ROOT"

WORKER_DIST="$REPO_ROOT/packages/config/dist/index.js"
if [[ ! -f "$WORKER_DIST" ]]; then
  echo "NOTE: $WORKER_DIST is not built. Worker-secret cases (8, 8b) will" >&2
  echo "      report REQUIRES OWNER INPUT instead of exercising the real" >&2
  echo "      validator. Run 'pnpm --filter @atlas/config build' first for" >&2
  echo "      full coverage." >&2
fi

# assert_exit <case-name> <expected-exit-code> <cp.env> <admin.env> <worker.env>
assert_exit() {
  local name="$1" expected="$2" cp="$3" admin="$4" worker="$5"
  local out actual
  out="$("$VALIDATOR" "$cp" "$admin" "$worker" 2>&1)"
  actual=$?
  if [[ "$actual" == "$expected" ]]; then
    printf 'PASS  %-45s (exit %s)\n' "$name" "$actual"
    PASS=$((PASS+1))
  else
    printf 'FAIL  %-45s expected exit %s, got %s\n' "$name" "$expected" "$actual"
    printf '%s\n' "$out" | sed 's/^/        | /'
    FAIL=$((FAIL+1))
  fi
}

# assert_contains <case-name> <expected-exit-code> <needle> <cp.env> <admin.env> <worker.env>
# Same as assert_exit but also requires a specific line of output to appear,
# so a case can't accidentally pass for the wrong reason (e.g. BLOCKED for a
# different, unrelated check).
assert_contains() {
  local name="$1" expected="$2" needle="$3" cp="$4" admin="$5" worker="$6"
  local out actual
  out="$("$VALIDATOR" "$cp" "$admin" "$worker" 2>&1)"
  actual=$?
  if [[ "$actual" == "$expected" ]] && grep -qF "$needle" <<<"$out"; then
    printf 'PASS  %-45s (exit %s, matched)\n' "$name" "$actual"
    PASS=$((PASS+1))
  else
    printf 'FAIL  %-45s expected exit %s + %q\n' "$name" "$expected" "$needle"
    printf '        got exit %s:\n' "$actual"
    printf '%s\n' "$out" | sed 's/^/        | /'
    FAIL=$((FAIL+1))
  fi
}

echo "== deploy/validate-production-env.sh self-test =="
echo

# --- 0. happy path: everything locally checkable is correct -----------------
write_cp    "$WORK/cp_ok.env"
write_admin "$WORK/admin_ok.env"
write_worker "$WORK/worker_ok.env"
if [[ -f "$WORKER_DIST" ]]; then
  # nginx snippet still doesn't exist in $WORK -> REQUIRES OWNER INPUT (2),
  # not READY (0). That's correct: this fixture never creates the snippet.
  assert_exit "0. happy path (nginx snippet absent -> OWNER)" 2 \
    "$WORK/cp_ok.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"
else
  assert_exit "0. happy path (config not built -> OWNER)" 2 \
    "$WORK/cp_ok.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"
fi

# --- 1. missing token --------------------------------------------------------
write_cp "$WORK/cp_1.env" "s/^ATLAS_CONTROL_PLANE_TOKEN=.*/ATLAS_CONTROL_PLANE_TOKEN=/"
assert_contains "1. missing token (CP operator token empty)" 1 \
  "ATLAS_CONTROL_PLANE_TOKEN is EMPTY" \
  "$WORK/cp_1.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"

# --- 2. duplicate token (or any duplicate key) -------------------------------
write_cp "$WORK/cp_2.env"
printf 'ATLAS_CONTROL_PLANE_TOKEN=%s\n' "$OPERATOR_TOKEN" >> "$WORK/cp_2.env"
assert_contains "2. duplicate variable definition" 1 \
  "is defined more than once" \
  "$WORK/cp_2.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"

# --- 3. operator == owner ----------------------------------------------------
write_cp "$WORK/cp_3.env" "s/^ATLAS_CONTROL_PLANE_OWNER_TOKEN=.*/ATLAS_CONTROL_PLANE_OWNER_TOKEN=$OPERATOR_TOKEN/"
assert_contains "3. operator token == owner token" 1 \
  "IDENTICAL" \
  "$WORK/cp_3.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"

# --- 4. admin/operator token mismatch ---------------------------------------
write_admin "$WORK/admin_4.env" "s/^ATLAS_CONTROL_PLANE_TOKEN=.*/ATLAS_CONTROL_PLANE_TOKEN=test_wrong_token_333333333333333333333/"
assert_contains "4. admin token != control-plane operator token" 1 \
  "MISMATCH" \
  "$WORK/cp_ok.env" "$WORK/admin_4.env" "$WORK/worker_ok.env"

# --- 5. empty WEB_ORIGIN ------------------------------------------------------
write_cp "$WORK/cp_5.env" "s/^WEB_ORIGIN=.*/WEB_ORIGIN=/"
assert_contains "5. empty WEB_ORIGIN" 2 \
  "WEB_ORIGIN is EMPTY" \
  "$WORK/cp_5.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"

# --- 6. invalid WEB_ORIGIN (not a URL) ---------------------------------------
write_cp "$WORK/cp_6.env" "s#^WEB_ORIGIN=.*#WEB_ORIGIN=not-a-url#"
assert_contains "6. invalid WEB_ORIGIN (not a URL)" 1 \
  "WEB_ORIGIN is not a valid https" \
  "$WORK/cp_6.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"

# --- 7. localhost incorrectly used as ATLAS_API_URL --------------------------
write_cp "$WORK/cp_7.env" "s#^ATLAS_API_URL=.*#ATLAS_API_URL=http://127.0.0.1:3100#"
assert_contains "7. localhost used as ATLAS_API_URL" 1 \
  "ATLAS_API_URL points at localhost/127.0.0.1" \
  "$WORK/cp_7.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"

# --- 8. missing worker secret -------------------------------------------------
write_worker "$WORK/worker_8.env" "/^DATABASE_URL=/d"
if [[ -f "$WORKER_DIST" ]]; then
  assert_contains "8. missing worker secret (DATABASE_URL)" 1 \
    "loadServerEnv() rejects it" \
    "$WORK/cp_ok.env" "$WORK/admin_ok.env" "$WORK/worker_8.env"
else
  echo "SKIP  8. missing worker secret (packages/config not built)"
fi

# --- 8b. placeholder worker secret (bonus, not in the required 10 but the
#         same code path the directive calls out: "never rotate silently /
#         never accept the documented example value") ------------------------
write_worker "$WORK/worker_8b.env" "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=12345678901234567890123456789012/"
if [[ -f "$WORKER_DIST" ]]; then
  assert_contains "8b. placeholder worker secret (example value)" 1 \
    "documented example value" \
    "$WORK/cp_ok.env" "$WORK/admin_ok.env" "$WORK/worker_8b.env"
else
  echo "SKIP  8b. placeholder worker secret (packages/config not built)"
fi

# --- 9. malformed URL (ATLAS_CONTROL_PLANE_URL not loopback) -----------------
write_admin "$WORK/admin_9.env" "s#^ATLAS_CONTROL_PLANE_URL=.*#ATLAS_CONTROL_PLANE_URL=https://not-loopback.example.com#"
assert_contains "9. ATLAS_CONTROL_PLANE_URL not loopback" 1 \
  "is not a loopback http" \
  "$WORK/cp_ok.env" "$WORK/admin_9.env" "$WORK/worker_ok.env"

# --- 10. insecure env file permissions ---------------------------------------
write_cp "$WORK/cp_10.env"
chmod 644 "$WORK/cp_10.env"
assert_contains "10. insecure env file permissions (644)" 1 \
  "expected 640 or 600" \
  "$WORK/cp_10.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"

# --- bonus: nginx auth snippet cross-check -----------------------------------
NGINX_OK="$WORK/nginx_ok.conf"
NGINX_PLACEHOLDER="$WORK/nginx_placeholder.conf"
NGINX_MISMATCH="$WORK/nginx_mismatch.conf"
printf 'proxy_set_header Authorization "Bearer %s";\n' "$OPERATOR_TOKEN" > "$NGINX_OK"
printf 'proxy_set_header Authorization "Bearer __TOKEN__";\n' > "$NGINX_PLACEHOLDER"
printf 'proxy_set_header Authorization "Bearer test_stale_token_4444444444444444444444";\n' > "$NGINX_MISMATCH"

if [[ -f "$WORKER_DIST" ]]; then
  ATLAS_NGINX_SNIPPET="$NGINX_OK" assert_exit "11. nginx snippet token matches (full READY)" 0 \
    "$WORK/cp_ok.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"
else
  echo "SKIP  11. nginx snippet token matches (packages/config not built, can't reach READY)"
fi
ATLAS_NGINX_SNIPPET="$NGINX_PLACEHOLDER" assert_contains "12. nginx snippet still has __TOKEN__ placeholder" 1 \
  "__TOKEN__ placeholder" \
  "$WORK/cp_ok.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"
ATLAS_NGINX_SNIPPET="$NGINX_MISMATCH" assert_contains "13. nginx snippet token stale/mismatched" 1 \
  "does NOT match control-plane.env's operator token" \
  "$WORK/cp_ok.env" "$WORK/admin_ok.env" "$WORK/worker_ok.env"

echo
echo "== $PASS passed, $FAIL failed =="
[[ "$FAIL" -eq 0 ]] || exit 1
exit 0
