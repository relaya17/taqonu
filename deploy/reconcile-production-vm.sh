#!/usr/bin/env bash
#
# deploy/reconcile-production-vm.sh — ATLAS production VM reconciliation.
#
# Modes (mutually exclusive, never combined implicitly):
#   --check    (default) READ-ONLY. Inspects everything, mutates nothing:
#              not /etc/atlas, not nginx, not systemd, not the repository.
#   --repair   Everything --check does, PLUS the two whitelisted safe
#              repairs (deploy/generate-tokens.sh, env-file permission/
#              ownership correction) -- ONLY if the repository gate passes.
#              Never starts/reloads/enables anything.
#   --start    Re-runs the full read-only check. Only if every gate is
#              satisfied does it start atlas-control-plane -> verify health
#              -> atlas-admin -> verify health -> atlas-worker -> verify
#              health, stopping immediately and reporting on the first
#              failure. Never repairs; run --repair first if needed.
#
# Order, always: preflight -> repository gate -> [backup + safe repair,
# --repair only] -> baseline validation -> [safe repair] -> final
# validation -> nginx/systemd/network/build verification -> readiness
# decision -> [start sequence, --start only].
#
# SECRET SAFETY (see section H of the accompanying report for the full
# audit): no .env file is ever cat'd, echoed, or diffed here -- every check
# on one goes through deploy/validate-production-env.sh (name/hash-based,
# never raw value) or deploy/generate-tokens.sh (writes, never prints). The
# nginx auth snippet (the one file that holds a real bearer token in
# plaintext) is only ever copied byte-for-byte (cp -p) into a root-only,
# mode-600 backup directory; its content is never read into a variable,
# grepped with -o, or diffed. This script does not set -x and does not
# source or eval anything derived from an env file.
#
# Usage:
#   sudo bash deploy/reconcile-production-vm.sh --check
#   sudo bash deploy/reconcile-production-vm.sh --repair
#   sudo bash deploy/reconcile-production-vm.sh --start
#
set -uo pipefail

# ---------------------------------------------------------------------------
# Overridable only for the test harness (deploy/reconcile-production-vm.test.sh).
# Production runs need none of these -- defaults are the real system paths.
# ---------------------------------------------------------------------------
ATLAS_ROOT="${ATLAS_ROOT:-/opt/atlas}"
ATLAS_ETC="${ATLAS_ETC:-/etc/atlas}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
NGINX_SNIPPET="${NGINX_SNIPPET:-/etc/nginx/snippets/atlas-admin-auth.conf}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/atlas-admin.conf}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/atlas}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-7c7bd60fc7651506f8fcf329c42f832629591108}"
SKIP_ROOT_CHECK="${RECONCILE_SKIP_ROOT_CHECK:-0}"
SERVICES=(atlas-control-plane atlas-admin atlas-worker)
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/${TS}"

# ---------------------------------------------------------------------------
# Mode parsing -- exactly one of --check / --repair / --start. No flag means
# --check (the strict read-only default). Two flags is a usage error, not a
# guess at which one wins.
# ---------------------------------------------------------------------------
MODE="check"
MODE_SEEN=0
for arg in "$@"; do
  case "$arg" in
    --check)  MODE="check";  MODE_SEEN=$((MODE_SEEN+1)) ;;
    --repair) MODE="repair"; MODE_SEEN=$((MODE_SEEN+1)) ;;
    --start)  MODE="start";  MODE_SEEN=$((MODE_SEEN+1)) ;;
    *) echo "Unknown argument: $arg (expected --check, --repair, or --start)" >&2; exit 64 ;;
  esac
done
if [[ "$MODE_SEEN" -gt 1 ]]; then
  echo "Refusing to run: more than one mode flag given. Modes are never combined -- run one at a time." >&2
  exit 64
fi

# ---------------------------------------------------------------------------
# Status vocabulary (per-check): PASS BLOCKED REQUIRES_OWNER_INPUT NOT_RUN
# EXPECTED_INACTIVE FAIL. ERROR_CODES accumulates the section 10 taxonomy
# whenever a check is BLOCKED or FAIL, so no failure is ever blank/ambiguous.
# ---------------------------------------------------------------------------
REPO_STATUS="NOT_RUN"
ENV_STATUS="NOT_RUN"
NGINX_CONFIG_STATUS="NOT_RUN"
NGINX_LISTENER_STATUS="NOT_RUN"
NGINX_STARTUP_REQUIRED="UNKNOWN"
SYSTEMD_STATUS="NOT_RUN"
NETWORK_STATUS="NOT_RUN"
BUILD_STATUS="NOT_RUN"
INSTALLATION_STATUS="NOT_RUN"
CONFIGURATION_STATUS="NOT_RUN"
RUNTIME_STATUS="NOT_RUN"
STARTUP_READINESS="NOT_RUN"
TOKEN_ACTION="NO_ACTION"
ERROR_CODES=()
MISSING_VARS=()

add_error() { ERROR_CODES+=("$1"); }

pass()      { printf '\033[1;32m  PASS\033[0m              %s\n' "$*"; }
blocked()   { printf '\033[1;31m  BLOCKED\033[0m           %s\n' "$*"; }
ownerin()   { printf '\033[1;33m  REQUIRES OWNER\033[0m    %s\n' "$*"; }
notrun()    { printf '\033[1;90m  NOT RUN\033[0m           %s\n' "$*"; }
expinact()  { printf '\033[1;36m  EXPECTED INACTIVE\033[0m %s\n' "$*"; }
fail()      { printf '\033[1;31m  FAIL\033[0m              %s\n' "$*"; }
info()      { printf '  ...        %s\n' "$*"; }
section()   { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
die()       { printf '\033[1;31mFATAL\033[0m %s\n' "$*" >&2; exit 1; }

if [[ "$SKIP_ROOT_CHECK" != "1" ]]; then
  [[ "$EUID" -eq 0 ]] || die "run with sudo (needs to read /etc/atlas and inspect systemd/nginx)"
fi

section "MODE: --${MODE}"
case "$MODE" in
  check)  info "Read-only. Nothing under /etc/atlas, nginx, systemd, or the repository will be written." ;;
  repair) info "Read-only checks, PLUS the two whitelisted safe repairs (token fill, permission fix) -- only if the repository gate passes. No service/nginx/systemd mutation." ;;
  start)  info "Full read-only re-check, then -- only if every gate is satisfied -- the startup sequence. No repair step runs in this mode." ;;
esac

# ===========================================================================
section "1. PREFLIGHT"
# ===========================================================================
info "host:        $(hostname 2>/dev/null || echo unknown) $(date -u +%Y-%m-%dT%H:%M:%SZ)"
info "atlas root:  $ATLAS_ROOT $( [[ -d "$ATLAS_ROOT" ]] && echo exists || echo MISSING )"
info "atlas etc:   $ATLAS_ETC $( [[ -d "$ATLAS_ETC" ]] && echo exists || echo MISSING )"
for f in control-plane admin worker; do
  info "  $ATLAS_ETC/$f.env: $( [[ -f "$ATLAS_ETC/$f.env" ]] && echo present || echo MISSING )"
done
info "nginx snippet: $( [[ -f "$NGINX_SNIPPET" ]] && echo present || echo MISSING )"

# ===========================================================================
section "2. REPOSITORY GATE"
# ===========================================================================
# Hard gate: on failure, no mutation happens in ANY mode, regardless of
# --repair/--start. This section only ever reads git state.
REPO_OK=0
REPO_HEAD="unknown"
REPO_BRANCH="unknown"
if [[ -d "$ATLAS_ROOT/.git" ]]; then
  if ( cd "$ATLAS_ROOT" && git rev-parse --git-dir >/dev/null 2>&1 ); then
    REPO_BRANCH="$(cd "$ATLAS_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    REPO_HEAD="$(cd "$ATLAS_ROOT" && git rev-parse HEAD 2>/dev/null || echo unknown)"
    ORIGIN_URL="$(cd "$ATLAS_ROOT" && git remote get-url origin 2>/dev/null || echo unknown)"
    DIRTY="$(cd "$ATLAS_ROOT" && git status --porcelain 2>/dev/null)"
    info "branch: $REPO_BRANCH"
    info "HEAD:   $REPO_HEAD"
    info "origin: $ORIGIN_URL"
    if [[ -n "$DIRTY" ]]; then
      blocked "repository has local modifications -- gate FAILS. No repair will run."
      printf '%s\n' "$DIRTY" | sed 's/^/             /'
      add_error "REPOSITORY_MISMATCH"
    elif [[ "$REPO_HEAD" == "$EXPECTED_COMMIT" ]]; then
      pass "HEAD is exactly the expected commit ($EXPECTED_COMMIT), tree clean."
      REPO_OK=1
    elif (cd "$ATLAS_ROOT" && git merge-base --is-ancestor "$EXPECTED_COMMIT" HEAD 2>/dev/null); then
      pass "HEAD is a descendant of the expected commit ($EXPECTED_COMMIT), tree clean."
      REPO_OK=1
    else
      blocked "HEAD ($REPO_HEAD) does not contain the expected commit $EXPECTED_COMMIT -- divergent or predates it. Gate FAILS. No repair will run. Do not reset/rebase automatically; review 'git log --oneline -10' yourself."
      add_error "REPOSITORY_MISMATCH"
    fi
  else
    fail "$ATLAS_ROOT/.git exists but is not a valid git directory."
    add_error "REPOSITORY_MISMATCH"
  fi
else
  fail "$ATLAS_ROOT/.git not found -- cannot verify repository version. Gate FAILS. No repair will run."
  add_error "REPOSITORY_MISMATCH"
fi
REPO_STATUS=$([[ "$REPO_OK" -eq 1 ]] && echo "PASS" || echo "BLOCKED")
[[ "$REPO_STATUS" == "BLOCKED" && "$REPO_HEAD" == "unknown" ]] && REPO_STATUS="FAIL"

if [[ "$REPO_OK" -eq 1 ]]; then
  VALIDATOR="$ATLAS_ROOT/deploy/validate-production-env.sh"
  GEN_TOKENS="$ATLAS_ROOT/deploy/generate-tokens.sh"
else
  VALIDATOR=""
  GEN_TOKENS=""
  info "repository gate failed -- validator/generate-tokens.sh paths under $ATLAS_ROOT are not trusted for this run; read-only checks below still use what exists on disk, but no repair step will invoke them."
fi

# ===========================================================================
section "3. BACKUP (only in --repair, and only after the repository gate passes)"
# ===========================================================================
BACKED_UP=0
if [[ "$MODE" == "repair" && "$REPO_OK" -eq 1 ]]; then
  # Real runs are always root by this point (enforced at the top of this
  # script unless RECONCILE_SKIP_ROOT_CHECK=1, which is documented as
  # test-harness-only) -- root:root ownership is set whenever it's actually
  # available. When it isn't (the fixture test harness, deliberately running
  # unprivileged), still create the directory with the same 0700 mode rather
  # than aborting the whole run on a chown that was never going to be
  # meaningful outside a real root session.
  if [[ "$EUID" -eq 0 ]]; then
    install -d -m 0700 -o root -g root "$BACKUP_DIR" 2>/dev/null || die "could not create $BACKUP_DIR"
  else
    install -d -m 0700 "$BACKUP_DIR" 2>/dev/null || die "could not create $BACKUP_DIR"
  fi
  MANIFEST="$BACKUP_DIR/manifest.json"
  {
    printf '{\n'
    printf '  "timestamp_utc": "%s",\n' "$TS"
    printf '  "hostname": "%s",\n' "$(hostname 2>/dev/null || echo unknown)"
    printf '  "repository_head": "%s",\n' "$REPO_HEAD"
    printf '  "repository_branch": "%s",\n' "$REPO_BRANCH"
    printf '  "mode": "%s",\n' "$MODE"
    printf '  "files": [\n'
  } > "$MANIFEST"
  first=1
  for f in "$ATLAS_ETC/control-plane.env" "$ATLAS_ETC/admin.env" "$ATLAS_ETC/worker.env" "$NGINX_SNIPPET"; do
    if [[ -f "$f" ]]; then
      cp -p "$f" "$BACKUP_DIR/$(basename "$f")" && BACKED_UP=$((BACKED_UP+1))
      perm="$(stat -c '%a' "$f" 2>/dev/null || echo unknown)"
      own="$(stat -c '%U:%G' "$f" 2>/dev/null || echo unknown)"
      [[ "$first" -eq 1 ]] || printf ',\n' >> "$MANIFEST"
      first=0
      printf '    {"path": "%s", "permissions": "%s", "owner": "%s"}' "$f" "$perm" "$own" >> "$MANIFEST"
    fi
  done
  { printf '\n  ]\n}\n'; } >> "$MANIFEST"
  chmod 0600 "$BACKUP_DIR"/* 2>/dev/null || true
  pass "backed up $BACKED_UP file(s) to $BACKUP_DIR (root-only, mode 600). Manifest at $MANIFEST lists paths/permissions/ownership only -- no content, no secrets."
elif [[ "$MODE" == "repair" ]]; then
  notrun "backup skipped -- repository gate did not pass."
else
  notrun "backup skipped -- only runs in --repair mode."
fi

# ===========================================================================
section "4. BASELINE VALIDATION (deploy/validate-production-env.sh, read-only)"
# ===========================================================================
run_validator() { # sets VALIDATOR_RC and VALIDATOR_OUTPUT
  if [[ -n "$VALIDATOR" && -x "$VALIDATOR" ]]; then
    # Explicit paths (not the validator's own /etc/atlas/*.env defaults) so
    # this genuinely checks the files under $ATLAS_ETC -- identical to the
    # real defaults in production, but correct if $ATLAS_ETC is ever
    # overridden (as the test harness does). ATLAS_NGINX_SNIPPET is passed
    # through the same way so its section 5b hash check inspects the same
    # snippet file this script itself is looking at, not the validator's own
    # hardcoded default.
    VALIDATOR_OUTPUT="$(ATLAS_NGINX_SNIPPET="$NGINX_SNIPPET" "$VALIDATOR" \
      "$ATLAS_ETC/control-plane.env" "$ATLAS_ETC/admin.env" "$ATLAS_ETC/worker.env" 2>&1)"
    VALIDATOR_RC=$?
    printf '%s\n' "$VALIDATOR_OUTPUT"
  elif [[ -n "$VALIDATOR" ]]; then
    fail "validator exists at $VALIDATOR but is not executable."
    VALIDATOR_OUTPUT=""
    VALIDATOR_RC=126
  else
    fail "validator not available (repository gate did not pass, or $ATLAS_ROOT/deploy/validate-production-env.sh is missing)."
    VALIDATOR_OUTPUT=""
    VALIDATOR_RC=127
  fi
}

run_validator
BASELINE_RC="$VALIDATOR_RC"
BASELINE_OUTPUT="$VALIDATOR_OUTPUT"

# ===========================================================================
section "5. SAFE REPAIR (--repair only, and only if the repository gate passed)"
# ===========================================================================
if [[ "$MODE" == "repair" && "$REPO_OK" -eq 1 ]]; then
  # --- token generation, gated on script identity/executability/format ----
  if [[ -n "$GEN_TOKENS" && -x "$GEN_TOKENS" ]]; then
    format_ok=1
    for f in "$ATLAS_ETC/control-plane.env" "$ATLAS_ETC/admin.env" "$ATLAS_ETC/worker.env"; do
      if [[ -f "$f" ]] && ! grep -qE '^[A-Z_][A-Z0-9_]*=' "$f" 2>/dev/null; then
        format_ok=0
      fi
    done
    if [[ "$format_ok" -eq 1 ]]; then
      info "deploy/generate-tokens.sh confirmed present, executable, repository-gated, and env files look like KEY=VALUE format. Running (fills ONLY empty lines, never overwrites, never rotates):"
      GEN_OUTPUT="$("$GEN_TOKENS" "$ATLAS_ETC/control-plane.env" "$ATLAS_ETC/admin.env" "$ATLAS_ETC/worker.env" 2>&1)"
      GEN_RC=$?
      printf '%s\n' "$GEN_OUTPUT"
      if printf '%s\n' "$GEN_OUTPUT" | grep -q 'GENERATED'; then
        TOKEN_ACTION="GENERATE_MISSING"
      elif [[ "$GEN_RC" -eq 0 ]]; then
        TOKEN_ACTION="KEEP_EXISTING"
      else
        TOKEN_ACTION="NO_ACTION"
        add_error "SECURITY_VALIDATION_FAILED"
      fi
    else
      ownerin "one or more env files do not look like KEY=VALUE format -- skipping token generation rather than guessing."
      TOKEN_ACTION="NO_ACTION"
    fi
  else
    ownerin "deploy/generate-tokens.sh not found or not executable at ${GEN_TOKENS:-<repository gate failed>} -- skipped."
    TOKEN_ACTION="NO_ACTION"
  fi

  # --- permission/ownership repair -----------------------------------------
  info "checking/repairing file mode + ownership on the three env files (root:atlas, 0640) -- metadata only, content untouched:"
  for f in "$ATLAS_ETC/control-plane.env" "$ATLAS_ETC/admin.env" "$ATLAS_ETC/worker.env"; do
    [[ -f "$f" ]] || continue
    cur_perm="$(stat -c '%a' "$f" 2>/dev/null || echo unknown)"
    cur_own="$(stat -c '%U:%G' "$f" 2>/dev/null || echo unknown)"
    if [[ "$cur_perm" == "640" || "$cur_perm" == "600" ]] && [[ "$cur_own" == "root:atlas" ]]; then
      pass "$(basename "$f"): already root:atlas $cur_perm -- untouched."
    else
      if chown root:atlas "$f" 2>/dev/null && chmod 0640 "$f" 2>/dev/null; then
        pass "$(basename "$f"): was $cur_own $cur_perm -- corrected to root:atlas 0640."
      else
        blocked "$(basename "$f"): was $cur_own $cur_perm -- could not correct (does the 'atlas' group exist?)."
        add_error "SECURITY_VALIDATION_FAILED"
      fi
    fi
  done
elif [[ "$MODE" == "repair" ]]; then
  notrun "safe repair skipped entirely -- repository gate did not pass. No token generation, no chmod/chown."
  TOKEN_ACTION="NO_ACTION"
else
  notrun "safe repair skipped -- only runs in --repair mode."
  TOKEN_ACTION="NO_ACTION"
fi

echo "TOKEN_ACTION=$TOKEN_ACTION"

# ===========================================================================
section "6. FINAL VALIDATION"
# ===========================================================================
if [[ "$MODE" == "repair" && "$REPO_OK" -eq 1 ]]; then
  info "re-running validator after repair -- this result is authoritative for ENV_STATUS:"
  run_validator
  FINAL_RC="$VALIDATOR_RC"
  FINAL_OUTPUT="$VALIDATOR_OUTPUT"
else
  FINAL_RC="$BASELINE_RC"
  FINAL_OUTPUT="$BASELINE_OUTPUT"
  info "using the baseline validation result from section 4 (no repair ran in this mode)."
fi

if [[ "$REPO_OK" -eq 0 ]]; then
  # The repository gate already failed (section 2) -- the validator was
  # deliberately never invoked (VALIDATOR="" from section 2), not because it
  # is broken. Do not relabel that as a checker failure: REPOSITORY_MISMATCH
  # already names the real root cause, and adding CHECKER_EXECUTION_FAILED
  # on top would be a second, misleading error code for one single problem.
  notrun "validator not evaluated -- the repository gate did not pass (see section 2 above). Fix the repository, then re-run."
  ENV_STATUS="NOT_RUN"
else
  case "$FINAL_RC" in
    0) pass "validator: READY"; ENV_STATUS="PASS" ;;
    1) blocked "validator: BLOCKED"; ENV_STATUS="BLOCKED"; add_error "ENVIRONMENT_INVALID" ;;
    2) ownerin "validator: REQUIRES OWNER INPUT"; ENV_STATUS="REQUIRES_OWNER_INPUT" ;;
    *) fail "validator did not run or exited unexpectedly (code $FINAL_RC)"; ENV_STATUS="FAIL"; add_error "CHECKER_EXECUTION_FAILED" ;;
  esac
fi

# Structured, per-variable surfacing for the two values that must never be
# guessed. Parsed from the validator's own (already secret-safe) output --
# not re-validated here, just re-shaped into the requested structured form.
for var in WEB_ORIGIN ATLAS_API_URL; do
  if printf '%s\n' "$FINAL_OUTPUT" | grep -qE "(OWNER|BLOCKED).*\b${var}\b"; then
    echo "REQUIRES_OWNER_INPUT"
    echo "MISSING_VARIABLE=${var}"
    MISSING_VARS+=("$var")
    [[ "$ENV_STATUS" == "PASS" ]] && ENV_STATUS="REQUIRES_OWNER_INPUT"
  fi
done
if printf '%s\n' "$FINAL_OUTPUT" | grep -q "MUST NOT be the Control Plane's own address"; then
  add_error "EXTERNAL_CONFIGURATION_MISSING"
fi

# ===========================================================================
section "7. NGINX — configuration validity, listener state, reload requirement (kept separate)"
# ===========================================================================
NGINX_CONFIG_OK=1
if [[ -f "$NGINX_SITE" || -L "$NGINX_SITE" ]]; then
  pass "site config present: $NGINX_SITE"
else
  blocked "$NGINX_SITE missing."
  NGINX_CONFIG_OK=0
fi

TS_IP=""
if command -v tailscale >/dev/null 2>&1; then
  TS_IP="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
fi

if [[ -n "$TS_IP" && -f "$NGINX_SITE" ]]; then
  if grep -q "$TS_IP" "$NGINX_SITE" 2>/dev/null; then
    pass "site config listens on the current Tailscale IP ($TS_IP)."
  else
    blocked "site config does not reference the current Tailscale IP ($TS_IP) -- possibly stale."
    NGINX_CONFIG_OK=0
  fi
fi
if [[ -f "$NGINX_SITE" ]] && grep -qE '0\.0\.0\.0|listen[[:space:]]+443|listen[[:space:]]+80[^0-9]' "$NGINX_SITE" 2>/dev/null; then
  blocked "site config appears to bind a public interface or port 80/443."
  NGINX_CONFIG_OK=0
fi

if [[ -f "$NGINX_SNIPPET" ]]; then
  # Pattern match only -- never reads the real token into a variable.
  if grep -q '__TOKEN__' "$NGINX_SNIPPET" 2>/dev/null; then
    ownerin "nginx auth snippet still has the __TOKEN__ placeholder."
    NGINX_CONFIG_OK=0
  else
    pass "nginx auth snippet has a token set (value not inspected here; the validator's own hash check already covers it)."
  fi
else
  blocked "$NGINX_SNIPPET missing."
  NGINX_CONFIG_OK=0
fi

if command -v nginx >/dev/null 2>&1; then
  info "running 'nginx -t' (syntax check only, never reloads):"
  NGINX_T_OUTPUT="$(nginx -t 2>&1)"
  NGINX_T_RC=$?
  printf '%s\n' "$NGINX_T_OUTPUT" | sed 's/^/             /'
  if [[ "$NGINX_T_RC" -eq 0 ]]; then
    pass "nginx -t passed."
  else
    blocked "nginx -t failed."
    NGINX_CONFIG_OK=0
  fi
else
  fail "nginx command not found."
  NGINX_CONFIG_OK=0
fi
NGINX_CONFIG_STATUS=$([[ "$NGINX_CONFIG_OK" -eq 1 ]] && echo "PASS" || echo "BLOCKED")
[[ "$NGINX_CONFIG_STATUS" == "BLOCKED" ]] && add_error "NGINX_VALIDATION_FAILED"

# Listener state is reported SEPARATELY from config validity: a missing
# listener before any start attempt is the expected, normal pre-start state
# (per the directive's "known VM state": services intentionally not
# started) -- it must never be silently folded into a bare PASS/FAIL.
if command -v ss >/dev/null 2>&1 && [[ -n "$TS_IP" ]]; then
  if ss -ltnH "sport = :8443" 2>/dev/null | grep -qE '0\.0\.0\.0:|\[::\]:'; then
    blocked "nginx :8443 is bound to a public interface."
    NGINX_LISTENER_STATUS="BLOCKED"
    add_error "NGINX_VALIDATION_FAILED"
  elif ss -ltnH "sport = :8443" 2>/dev/null | grep -q "$TS_IP"; then
    pass "nginx :8443 is listening on the Tailscale IP."
    NGINX_LISTENER_STATUS="PASS"
  elif [[ "$MODE" == "start" ]]; then
    fail "nginx :8443 has no listener even though --start requires one."
    NGINX_LISTENER_STATUS="FAIL"
    add_error "NGINX_VALIDATION_FAILED"
  else
    expinact "nginx :8443 has no listener yet -- expected pre-start, not a failure."
    NGINX_LISTENER_STATUS="EXPECTED_INACTIVE"
  fi
else
  notrun "listener check skipped ('ss' or Tailscale IP unavailable)."
  NGINX_LISTENER_STATUS="NOT_RUN"
fi
if [[ "$NGINX_LISTENER_STATUS" == "EXPECTED_INACTIVE" || "$NGINX_LISTENER_STATUS" == "NOT_RUN" ]]; then
  NGINX_STARTUP_REQUIRED="YES"
elif [[ "$NGINX_LISTENER_STATUS" == "PASS" ]]; then
  NGINX_STARTUP_REQUIRED="NO"
else
  NGINX_STARTUP_REQUIRED="UNKNOWN"
fi

# ===========================================================================
section "8. SYSTEMD — unit files vs. repository, current state (informational)"
# ===========================================================================
SYSTEMD_OK=1
for unit in "${SERVICES[@]}"; do
  installed="$SYSTEMD_DIR/${unit}.service"
  repo_copy="$ATLAS_ROOT/deploy/systemd/${unit}.service"
  if [[ ! -f "$installed" ]]; then
    blocked "$unit: $installed does not exist."
    SYSTEMD_OK=0
    continue
  fi
  if [[ "$REPO_OK" -eq 1 && -f "$repo_copy" ]]; then
    if diff -q "$installed" "$repo_copy" >/dev/null 2>&1; then
      pass "$unit: installed unit matches the repository's deploy/systemd/${unit}.service exactly."
    else
      blocked "$unit: installed unit DIFFERS from the repository copy -- not auto-replaced. Review 'diff $installed $repo_copy'."
      SYSTEMD_OK=0
    fi
  else
    ownerin "$unit: cannot compare against the repository (gate not passed or copy missing)."
  fi
  ef_line="$(grep -E '^EnvironmentFile=' "$installed" 2>/dev/null || echo 'none found')"
  wd_line="$(grep -E '^WorkingDirectory=' "$installed" 2>/dev/null || echo 'none found')"
  info "  $unit: $ef_line"
  info "  $unit: $wd_line"
  state="$(systemctl is-active "$unit" 2>/dev/null || echo inactive)"
  if [[ "$state" == "active" ]]; then
    info "  $unit: currently active"
  else
    info "  $unit: currently $state (expected pre-start)"
  fi
done
SYSTEMD_STATUS=$([[ "$SYSTEMD_OK" -eq 1 ]] && echo "PASS" || echo "BLOCKED")
[[ "$SYSTEMD_STATUS" == "BLOCKED" ]] && add_error "SYSTEMD_VALIDATION_FAILED"

# ===========================================================================
section "9. NETWORK — Tailscale / UFW / listeners"
# ===========================================================================
NET_OK=1
if command -v tailscale >/dev/null 2>&1; then
  info "tailscale status --self:"
  tailscale status --self 2>&1 | sed 's/^/             /'
  if [[ -n "$TS_IP" ]]; then
    pass "Tailscale IPv4 assigned: $TS_IP"
  else
    blocked "no Tailscale IPv4."
    NET_OK=0
  fi
else
  fail "tailscale command not found."
  NET_OK=0
fi

if command -v ufw >/dev/null 2>&1; then
  if ufw status verbose 2>/dev/null | grep -q 'Default: deny (incoming)'; then
    pass "ufw default-deny-incoming is active."
  else
    blocked "ufw default is not deny-incoming."
    NET_OK=0
  fi
else
  fail "ufw command not found."
  NET_OK=0
fi

if command -v ss >/dev/null 2>&1; then
  for port in 3100 3200; do
    if ss -ltnH "sport = :$port" 2>/dev/null | grep -qE '0\.0\.0\.0:|\[::\]:'; then
      blocked "port $port is bound to a public interface."
      NET_OK=0
    elif ss -ltnH "sport = :$port" 2>/dev/null | grep -q '127.0.0.1'; then
      pass "port $port is loopback-only."
    elif [[ "$MODE" == "start" ]]; then
      fail "port $port has no listener even though --start requires one."
      NET_OK=0
    else
      expinact "nothing listening on port $port yet -- expected pre-start."
    fi
  done
else
  fail "ss command not found."
  NET_OK=0
fi
NETWORK_STATUS=$([[ "$NET_OK" -eq 1 ]] && echo "PASS" || echo "BLOCKED")
[[ "$NETWORK_STATUS" == "BLOCKED" ]] && add_error "NETWORK_VALIDATION_FAILED"

# ===========================================================================
section "10. BUILD ARTIFACTS"
# ===========================================================================
BUILD_OK=1
for d in apps/control-plane/dist apps/admin/dist apps/worker/dist; do
  full="$ATLAS_ROOT/$d"
  if [[ -d "$full" ]] && find "$full" -name '*.js' -print -quit 2>/dev/null | grep -q .; then
    pass "$d present and non-empty."
  else
    blocked "$d missing or empty. Not rebuilt automatically."
    BUILD_OK=0
  fi
done
BUILD_STATUS=$([[ "$BUILD_OK" -eq 1 ]] && echo "PASS" || echo "BLOCKED")
[[ "$BUILD_STATUS" == "BLOCKED" ]] && add_error "BUILD_ARTIFACT_MISSING"

# ===========================================================================
section "11. ROLLUP — installation / configuration / runtime / startup readiness"
# ===========================================================================
sev() { # numeric severity for aggregation; higher = worse
  case "$1" in
    FAIL) echo 5 ;;
    BLOCKED) echo 4 ;;
    REQUIRES_OWNER_INPUT) echo 3 ;;
    EXPECTED_INACTIVE|NOT_RUN) echo 1 ;;
    PASS) echo 0 ;;
    *) echo 2 ;;
  esac
}
max_status() {
  local best="PASS" best_sev; best_sev=0
  for s in "$@"; do
    local v; v=$(sev "$s")
    if [[ "$v" -gt "$best_sev" ]]; then best_sev="$v"; best="$s"; fi
  done
  echo "$best"
}

INSTALLATION_STATUS="$(max_status "$REPO_STATUS" "$BUILD_STATUS")"
[[ -f "$SYSTEMD_DIR/atlas-control-plane.service" ]] || INSTALLATION_STATUS="$(max_status "$INSTALLATION_STATUS" "BLOCKED")"
[[ -f "$NGINX_SITE" || -L "$NGINX_SITE" ]] || INSTALLATION_STATUS="$(max_status "$INSTALLATION_STATUS" "BLOCKED")"

CONFIGURATION_STATUS="$(max_status "$ENV_STATUS" "$NGINX_CONFIG_STATUS" "$SYSTEMD_STATUS")"

if [[ "$MODE" == "start" ]]; then
  RUNNING=1
  for unit in "${SERVICES[@]}"; do
    [[ "$(systemctl is-active "$unit" 2>/dev/null || echo inactive)" == "active" ]] || RUNNING=0
  done
  RUNTIME_STATUS=$([[ "$RUNNING" -eq 1 ]] && echo "PASS" || echo "EXPECTED_INACTIVE")
else
  ANY_ACTIVE=0
  for unit in "${SERVICES[@]}"; do
    [[ "$(systemctl is-active "$unit" 2>/dev/null || echo inactive)" == "active" ]] && ANY_ACTIVE=1
  done
  RUNTIME_STATUS=$([[ "$ANY_ACTIVE" -eq 1 ]] && echo "PASS" || echo "EXPECTED_INACTIVE")
fi

STARTUP_READINESS="$(max_status "$INSTALLATION_STATUS" "$CONFIGURATION_STATUS" "$NETWORK_STATUS")"
pass_or_report() {
  case "$STARTUP_READINESS" in
    PASS) pass "STARTUP_READINESS: all installation/configuration/network checks pass." ;;
    REQUIRES_OWNER_INPUT) ownerin "STARTUP_READINESS: blocked only on external input (see MISSING_VARIABLE lines above)." ;;
    *) blocked "STARTUP_READINESS: not ready -- see BLOCKED/FAIL lines above." ;;
  esac
}
pass_or_report

# ===========================================================================
section "12. START SEQUENCE (--start only, and only if STARTUP_READINESS allows it)"
# ===========================================================================
SERVICE_START_ERROR=0
if [[ "$MODE" == "start" ]]; then
  if [[ "$STARTUP_READINESS" != "PASS" ]]; then
    blocked "Refusing to start services: STARTUP_READINESS is $STARTUP_READINESS, not PASS. Run --repair (if BLOCKED on a local issue) or supply the missing external values (if REQUIRES_OWNER_INPUT), then re-run --check before trying --start again."
    add_error "SERVICE_START_FAILED"
    SERVICE_START_ERROR=1
  else
    info "All gates satisfied. Starting in sequence: validate env -> validate nginx -> control-plane -> verify -> admin -> verify -> worker -> verify."
    if ! nginx -t >/dev/null 2>&1; then
      fail "nginx -t failed immediately before start -- aborting."
      SERVICE_START_ERROR=1
      add_error "SERVICE_START_FAILED"
    else
      for unit in "${SERVICES[@]}"; do
        info "starting $unit ..."
        if systemctl enable --now "$unit" >/dev/null 2>&1 && sleep 2 && systemctl is-active --quiet "$unit"; then
          pass "$unit is active."
        else
          fail "$unit failed to become active. Stopping here -- not starting the remaining services. journalctl -u $unit -n 50 for detail."
          SERVICE_START_ERROR=1
          add_error "SERVICE_START_FAILED"
          break
        fi
      done
    fi
  fi
else
  notrun "start sequence skipped -- only runs in --start mode."
fi
RUNTIME_STATUS=$([[ "$MODE" == "start" && "$SERVICE_START_ERROR" -eq 0 && "$STARTUP_READINESS" == "PASS" ]] && echo "PASS" || echo "$RUNTIME_STATUS")

# ===========================================================================
section "SUMMARY"
# ===========================================================================
OVERALL_SEV=$(sev "$(max_status "$REPO_STATUS" "$ENV_STATUS" "$NGINX_CONFIG_STATUS" "$SYSTEMD_STATUS" "$NETWORK_STATUS" "$BUILD_STATUS")")
if [[ "$OVERALL_SEV" -ge 5 ]]; then
  OVERALL_STATUS="REPAIR_REQUIRED"
elif [[ "$OVERALL_SEV" -ge 4 ]]; then
  OVERALL_STATUS="BLOCKED"
elif [[ "$OVERALL_SEV" -ge 3 ]]; then
  OVERALL_STATUS="REQUIRES_OWNER_INPUT"
elif [[ "$MODE" == "start" && "$SERVICE_START_ERROR" -eq 1 ]]; then
  OVERALL_STATUS="BLOCKED"
else
  OVERALL_STATUS="READY_FOR_START"
fi

ERR_JOINED="NONE"
if [[ "${#ERROR_CODES[@]}" -gt 0 ]]; then
  ERR_JOINED="$(printf '%s,' "${ERROR_CODES[@]}")"
  ERR_JOINED="${ERR_JOINED%,}"
fi
MISSING_JOINED="NONE"
if [[ "${#MISSING_VARS[@]}" -gt 0 ]]; then
  MISSING_JOINED="$(printf '%s,' "${MISSING_VARS[@]}")"
  MISSING_JOINED="${MISSING_JOINED%,}"
fi

cat <<EOF

MODE=$MODE
REPO_STATUS=$REPO_STATUS
ENV_STATUS=$ENV_STATUS
TOKEN_ACTION=$TOKEN_ACTION
NGINX_CONFIG_STATUS=$NGINX_CONFIG_STATUS
NGINX_LISTENER_STATUS=$NGINX_LISTENER_STATUS
NGINX_STARTUP_REQUIRED=$NGINX_STARTUP_REQUIRED
SYSTEMD_STATUS=$SYSTEMD_STATUS
NETWORK_STATUS=$NETWORK_STATUS
BUILD_STATUS=$BUILD_STATUS
INSTALLATION_STATUS=$INSTALLATION_STATUS
CONFIGURATION_STATUS=$CONFIGURATION_STATUS
RUNTIME_STATUS=$RUNTIME_STATUS
STARTUP_READINESS=$STARTUP_READINESS
MISSING_VARIABLES=$MISSING_JOINED
ERROR_CODES=$ERR_JOINED
OVERALL_STATUS=$OVERALL_STATUS
EOF

if [[ "$MODE" != "start" ]]; then
  echo
  echo "This run never started, restarted, enabled, or reloaded anything."
fi
[[ "$BACKED_UP" -gt 0 ]] && echo "Backup: $BACKUP_DIR (root-only, contents never displayed)"

case "$OVERALL_STATUS" in
  READY_FOR_START) exit 0 ;;
  REQUIRES_OWNER_INPUT) exit 2 ;;
  BLOCKED) exit 1 ;;
  REPAIR_REQUIRED) exit 3 ;;
esac
