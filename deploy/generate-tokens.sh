#!/usr/bin/env bash
#
# Atlas — safe, non-rotating secret generator for the private plane
# (control-plane.env: operator + owner tokens; worker.env: ENCRYPTION_KEY +
# COOKIE_SECRET; admin.env: copies the operator token in, never generates a
# new one there).
#
# HARD RULE, restated from the deployment repair directive: this script
# NEVER overwrites an existing, already-filled value. It only ever fills a
# line that is present in the file with an empty value (`KEY=` with nothing
# after the `=`). Rotating an existing token is a separate, explicit,
# human-decided action -- this script deliberately has no flag to force it.
# Re-running this script against a fully-configured install is always a
# no-op (every line already has a value, so nothing changes).
#
# SECURITY: never prints, logs, or echoes a secret value. Reports only
# GENERATED / ALREADY SET / COPIED / SKIPPED against a variable NAME.
#
# Usage:
#   sudo ./deploy/generate-tokens.sh
#   ./deploy/generate-tokens.sh <cp.env> <admin.env> <worker.env>
#     (3-argument form: what deploy/validate-production-env.test.sh-style
#     fixture tests would use -- no sudo, no real secrets, ownership is
#     skipped automatically when files aren't owned by root)
#
# Exit codes:
#   0  every fillable field was already set, or was safely filled
#   1  one or more fields could NOT be safely filled (duplicate key in the
#      file, or the key line is missing entirely) -- these need a human to
#      fix the file by hand; this script will not guess how.
set -uo pipefail

CP_ENV="${1:-/etc/atlas/control-plane.env}"
ADMIN_ENV="${2:-/etc/atlas/admin.env}"
WORKER_ENV="${3:-/etc/atlas/worker.env}"

PROBLEMS=0

info()    { printf '\033[1;32m  OK\033[0m       %s\n' "$*"; }
warn()    { printf '\033[1;33m  SKIP\033[0m     %s\n' "$*"; }
problem() { printf '\033[1;31m  PROBLEM\033[0m  %s\n' "$*"; PROBLEMS=$((PROBLEMS+1)); }
section() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
gen_secret() { # 48 random bytes, base64 -- 64 chars, well over the 32-char
               # minimum @atlas/config enforces for ENCRYPTION_KEY/COOKIE_SECRET.
  openssl rand -base64 48 | tr -d '\n'
}

count_key_lines() { # $1=file $2=key -- number of lines starting with KEY=
  local f="$1" key="$2"
  [[ -f "$f" ]] || { echo 0; return; }
  grep -cE "^${key}=" "$f" 2>/dev/null
}

get_value() { # $1=file $2=key -- prints the value of the sole KEY= line (empty if none/empty)
  local f="$1" key="$2"
  [[ -f "$f" ]] || return
  grep -E "^${key}=" "$f" 2>/dev/null | tail -n1 | cut -d= -f2-
}

# fill_empty_value <file> <key> <value> -- rewrites the file line-by-line,
# replacing the FIRST line that reads exactly "KEY=" (empty value) with
# "KEY=<value>". Deliberately not sed/awk substitution: the value can
# contain '/', '+', '=' (base64 output) which would need fragile escaping
# as a sed replacement string. A plain line-for-line rewrite has no such
# issue because the value only ever goes through printf '%s', never through
# a pattern-matching engine.
fill_empty_value() {
  local f="$1" key="$2" value="$3"
  local tmp replaced=0
  tmp="$(mktemp)"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$replaced" -eq 0 && "$line" == "${key}=" ]]; then
      printf '%s=%s\n' "$key" "$value" >> "$tmp"
      replaced=1
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$f"
  if [[ "$replaced" -eq 1 ]]; then
    cat "$tmp" > "$f"
  fi
  rm -f "$tmp"
  [[ "$replaced" -eq 1 ]]
}

# ensure_secret <label> <file> <key> -- fills KEY in file with a fresh
# secret ONLY if it is currently present-and-empty and not duplicated.
# Never touches a key that already has a non-empty value.
ensure_secret() {
  local label="$1" f="$2" key="$3"
  if [[ ! -f "$f" ]]; then
    problem "$label: $f does not exist -- cannot generate $key. Copy it from deploy/env/*.env.example first."
    return
  fi
  local n; n="$(count_key_lines "$f" "$key")"
  if [[ "$n" -gt 1 ]]; then
    problem "$label: $key is defined $n times in $(basename "$f") -- refusing to guess which one is active. Run deploy/validate-production-env.sh, remove the duplicates, then re-run this script."
    return
  fi
  if [[ "$n" -eq 0 ]]; then
    problem "$label: $key has no line at all in $(basename "$f") -- refusing to invent a new line in a file whose structure I don't own. Add '$key=' from deploy/env/$(basename "${f%.env}").env.example and re-run."
    return
  fi
  local current; current="$(get_value "$f" "$key")"
  if [[ -n "$current" ]]; then
    info "$label: $key is already set -- left untouched (this script never rotates an existing value)."
    return
  fi
  local secret; secret="$(gen_secret)"
  # Defensive, not expected to ever trigger: refuse to write the documented
  # example placeholder even if some future gen_secret() implementation
  # could theoretically produce it.
  if [[ "$secret" == "12345678901234567890123456789012" ]]; then
    secret="$(gen_secret)"
  fi
  if fill_empty_value "$f" "$key" "$secret"; then
    info "$label: $key was empty -- GENERATED a new value (openssl rand -base64 48)."
  else
    problem "$label: $key: expected exactly one empty '$key=' line but none was found at write time (race or unexpected format) -- no change made."
  fi
}

# ===========================================================================
section "1. Control Plane — operator + owner tokens"
# ===========================================================================
if [[ -f "$CP_ENV" ]]; then
  op_lines="$(count_key_lines "$CP_ENV" "ATLAS_CONTROL_PLANE_TOKEN")"
  own_lines="$(count_key_lines "$CP_ENV" "ATLAS_CONTROL_PLANE_OWNER_TOKEN")"

  # Operator token: handled on its own -- a problem with the owner line must
  # never prevent a perfectly fillable operator line from being filled (and
  # vice versa below). Each of the two gets an independent, unambiguous
  # outcome every run.
  if [[ "$op_lines" -eq 1 ]]; then
    ensure_secret "control-plane.env" "$CP_ENV" "ATLAS_CONTROL_PLANE_TOKEN"
  elif [[ "$op_lines" -gt 1 ]]; then
    problem "control-plane.env: ATLAS_CONTROL_PLANE_TOKEN is defined $op_lines times -- remove duplicates first."
  else
    problem "control-plane.env: ATLAS_CONTROL_PLANE_TOKEN has no line at all -- copy it from deploy/env/control-plane.env.example."
  fi

  # Owner token: same independent handling. When it needs generating AND the
  # operator line is unambiguous (exactly one, and therefore has a single
  # well-defined current value after the step above), also confirm the new
  # owner value is distinct from it -- regenerating up to 5 times on the
  # astronomically unlikely event of a collision, per the directive's
  # explicit "guaranteed-distinct" requirement. If the operator line is
  # itself ambiguous (missing/duplicated), the owner token still gets a
  # fresh independent secret; deploy/validate-production-env.sh is what
  # authoritatively re-checks the operator/owner relationship afterward.
  if [[ "$own_lines" -eq 1 ]]; then
    own_before="$(get_value "$CP_ENV" "ATLAS_CONTROL_PLANE_OWNER_TOKEN")"
    if [[ -z "$own_before" ]]; then
      op_now=""
      [[ "$op_lines" -eq 1 ]] && op_now="$(get_value "$CP_ENV" "ATLAS_CONTROL_PLANE_TOKEN")"
      attempt=0
      candidate="$(gen_secret)"
      while [[ -n "$op_now" && "$candidate" == "$op_now" && "$attempt" -lt 5 ]]; do
        candidate="$(gen_secret)"
        attempt=$((attempt+1))
      done
      if [[ -n "$op_now" && "$candidate" == "$op_now" ]]; then
        problem "control-plane.env: ATLAS_CONTROL_PLANE_OWNER_TOKEN: could not generate a value distinct from the operator token after 5 attempts (this should never happen) -- no change made."
      elif fill_empty_value "$CP_ENV" "ATLAS_CONTROL_PLANE_OWNER_TOKEN" "$candidate"; then
        if [[ -n "$op_now" ]]; then
          info "control-plane.env: ATLAS_CONTROL_PLANE_OWNER_TOKEN was empty -- GENERATED a new value, confirmed distinct from the operator token."
        else
          info "control-plane.env: ATLAS_CONTROL_PLANE_OWNER_TOKEN was empty -- GENERATED a new value (operator token line was ambiguous, so distinctness will be re-checked by validate-production-env.sh)."
        fi
      else
        problem "control-plane.env: ATLAS_CONTROL_PLANE_OWNER_TOKEN: expected exactly one empty line but none was found at write time -- no change made."
      fi
    else
      info "control-plane.env: ATLAS_CONTROL_PLANE_OWNER_TOKEN is already set -- left untouched."
    fi
  elif [[ "$own_lines" -gt 1 ]]; then
    problem "control-plane.env: ATLAS_CONTROL_PLANE_OWNER_TOKEN is defined $own_lines times -- remove duplicates first."
  else
    problem "control-plane.env: ATLAS_CONTROL_PLANE_OWNER_TOKEN has no line at all -- copy it from deploy/env/control-plane.env.example."
  fi
else
  problem "control-plane.env: $CP_ENV does not exist."
fi

# ===========================================================================
section "2. Worker — ENCRYPTION_KEY, COOKIE_SECRET"
# ===========================================================================
ensure_secret "worker.env" "$WORKER_ENV" "ENCRYPTION_KEY"
ensure_secret "worker.env" "$WORKER_ENV" "COOKIE_SECRET"

# ===========================================================================
section "3. Admin — copy the operator token in (never generates a new one)"
# ===========================================================================
# admin.env's ATLAS_CONTROL_PLANE_TOKEN is not a secret Admin owns -- it MUST
# equal control-plane.env's operator token exactly (ADR-021: one shared
# operator credential, checked both inbound by admin-auth.ts and outbound by
# server.ts). So this step COPIES a known value; it never calls gen_secret().
if [[ -f "$ADMIN_ENV" ]]; then
  admin_lines="$(count_key_lines "$ADMIN_ENV" "ATLAS_CONTROL_PLANE_TOKEN")"
  if [[ "$admin_lines" -gt 1 ]]; then
    problem "admin.env: ATLAS_CONTROL_PLANE_TOKEN is defined $admin_lines times -- remove duplicates first."
  elif [[ "$admin_lines" -eq 0 ]]; then
    problem "admin.env: ATLAS_CONTROL_PLANE_TOKEN has no line at all -- copy it from deploy/env/admin.env.example."
  else
    admin_current="$(get_value "$ADMIN_ENV" "ATLAS_CONTROL_PLANE_TOKEN")"
    if [[ -n "$admin_current" ]]; then
      info "admin.env: ATLAS_CONTROL_PLANE_TOKEN is already set -- left untouched (run deploy/validate-production-env.sh to confirm it still matches control-plane.env)."
    else
      op_now="$([[ -f "$CP_ENV" ]] && get_value "$CP_ENV" "ATLAS_CONTROL_PLANE_TOKEN" || true)"
      if [[ -z "${op_now:-}" ]]; then
        warn "admin.env: ATLAS_CONTROL_PLANE_TOKEN is empty, and control-plane.env's operator token isn't set yet either -- run this script again after step 1 has a value to copy."
      elif fill_empty_value "$ADMIN_ENV" "ATLAS_CONTROL_PLANE_TOKEN" "$op_now"; then
        info "admin.env: ATLAS_CONTROL_PLANE_TOKEN was empty -- COPIED control-plane.env's operator token (not a new secret -- the two must be identical by design)."
      else
        problem "admin.env: ATLAS_CONTROL_PLANE_TOKEN: expected exactly one empty line but none was found at write time -- no change made."
      fi
    fi
  fi
else
  problem "admin.env: $ADMIN_ENV does not exist."
fi

# ===========================================================================
section "4. File permissions"
# ===========================================================================
# Only attempted when running as root against the real system paths (the
# 3-argument test/fixture form never needs this -- disposable fixtures don't
# need root:atlas ownership, and validate-production-env.sh is the
# authoritative permission checker either way).
if [[ "$EUID" -eq 0 ]]; then
  for f in "$CP_ENV" "$ADMIN_ENV" "$WORKER_ENV"; do
    [[ -f "$f" ]] || continue
    if chown root:atlas "$f" 2>/dev/null && chmod 0640 "$f" 2>/dev/null; then
      info "$(basename "$f"): ownership/permissions set to root:atlas 0640."
    else
      warn "$(basename "$f"): could not set root:atlas/0640 (does the 'atlas' group exist yet? deploy/bootstrap.sh creates it). Run deploy/validate-production-env.sh to confirm the final state."
    fi
  done
else
  warn "not running as root -- skipped ownership/permission enforcement. Run 'sudo deploy/generate-tokens.sh' for the real system paths, or run deploy/validate-production-env.sh afterward to confirm permissions."
fi

# ===========================================================================
section "RESULT"
# ===========================================================================
if [[ "$PROBLEMS" -gt 0 ]]; then
  echo "$PROBLEMS item(s) could not be safely filled -- see PROBLEM lines above. Fix those by hand, then re-run."
  echo "Next step once every field is filled: sudo ./deploy/validate-production-env.sh"
  exit 1
else
  echo "All fillable fields are set. Next step: sudo ./deploy/validate-production-env.sh"
  exit 0
fi
