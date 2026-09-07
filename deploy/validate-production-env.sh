#!/usr/bin/env bash
#
# Atlas — deterministic production environment validator (ADR-021 private
# plane: control-plane, admin, worker).
#
# Purpose: replace ad-hoc manual inspection of /etc/atlas/*.env with a single
# authoritative, repeatable check that runs BEFORE any atlas-* service is
# started. deploy/bootstrap.sh runs this at the end of provisioning and
# reports READY / BLOCKED / REQUIRES OWNER INPUT instead of leaving the
# operator to guess what's left. deploy/verify.sh runs this first, before its
# own live (post-startup) checks.
#
# Design note — this deliberately does NOT re-implement worker secret
# validation: apps/worker (via @atlas/config's loadServerEnv) already has a
# real, tested, code-level validator (assertProductionSecrets /
# assertNotExampleSecrets) that hard-fails startup on a missing or
# placeholder secret. Duplicating that logic here in bash would create two
# sources of truth that can drift. Instead, §5 below shells out to the real,
# built loadServerEnv() and reports its verdict. Everything else here (
# duplicate-key detection, file permissions, control-plane/admin cross-checks
# that have no code-level equivalent) is genuinely new coverage, not a
# duplicate of anything that already exists.
#
# SECURITY: this script never prints a secret VALUE. It only ever reports
# PRESENT / EMPTY / DUPLICATE / MISMATCH / INVALID / PLACEHOLDER against a
# variable NAME, and compares secrets by SHA-256 hash, never by value.
#
# Exit codes (bootstrap.sh branches on these):
#   0  READY                 — every check passed, safe to start services.
#   1  BLOCKED                — a locally-fixable misconfiguration exists
#                               (duplicate key, bad permissions, mismatched
#                               tokens, malformed URL, placeholder secret).
#   2  REQUIRES OWNER INPUT   — the only remaining gaps are values that must
#                               come from an external system (Vercel,
#                               Supabase) or the owner, and cannot be
#                               generated or inferred locally.
#
# Usage:
#   sudo ./deploy/validate-production-env.sh
#   ./deploy/validate-production-env.sh <cp.env> <admin.env> <worker.env>
#     (the 3-argument form is what deploy/validate-production-env.test.sh
#     uses against disposable fixture files — no sudo, no real secrets)
#
# Environment overrides (all optional; production runs need none of them —
# these exist solely so deploy/validate-production-env.test.sh can exercise
# every branch against disposable fixtures without root or a real checkout):
#   ATLAS_ROOT                        monorepo root (default /opt/atlas).
#                                      Used to locate
#                                      packages/config/dist/index.js for the
#                                      worker delegation check.
#   ATLAS_NGINX_SNIPPET                path to the nginx auth snippet
#                                      (default the real system path under
#                                      /etc/nginx).
#   ATLAS_VALIDATE_SKIP_OWNERSHIP=1   skip the root:atlas ownership check
#                                      (permission-mode checks still run).
set -uo pipefail

ATLAS_ROOT="${ATLAS_ROOT:-/opt/atlas}"
CP_ENV="${1:-/etc/atlas/control-plane.env}"
ADMIN_ENV="${2:-/etc/atlas/admin.env}"
WORKER_ENV="${3:-/etc/atlas/worker.env}"
# Set to 1 by the test harness, which cannot chown fixture files to
# root:atlas without real root privilege on the test machine. Production
# runs (the default) always enforce ownership.
SKIP_OWNERSHIP="${ATLAS_VALIDATE_SKIP_OWNERSHIP:-0}"

BLOCKED=0
OWNER_INPUT=0
PASS=0

ok()      { printf '\033[1;32m  OK\033[0m       %s\n' "$*"; PASS=$((PASS+1)); }
blocked() { printf '\033[1;31m  BLOCKED\033[0m  %s\n' "$*"; BLOCKED=$((BLOCKED+1)); }
owner_()  { printf '\033[1;33m  OWNER\033[0m    %s\n' "$*"; OWNER_INPUT=$((OWNER_INPUT+1)); }
section() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }

EXAMPLE_SECRET="12345678901234567890123456789012"

# ---------------------------------------------------------------------------
# helpers — none of these ever print a value to stdout/stderr themselves.
# ---------------------------------------------------------------------------

raw_pairs() { # $1=file -- comments/blank lines stripped, no shell eval
  local f="$1"
  [[ -r "$f" ]] || return 1
  grep -vE '^[[:space:]]*(#|$)' "$f"
}

VALUE_OUT=""
get_value() { # $1=file $2=key -- last-occurrence, matching dotenv semantics
  local f="$1" key="$2"
  VALUE_OUT="$(raw_pairs "$f" 2>/dev/null | grep -E "^${key}=" | tail -n1 | cut -d= -f2-)"
}

status_of() { # PRESENT|EMPTY
  local f="$1" key="$2"
  get_value "$f" "$key"
  [[ -n "$VALUE_OUT" ]] && echo PRESENT || echo EMPTY
}

hash_of() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

is_https_url() { [[ "$1" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$ ]]; }
is_loopback_http_url() { [[ "$1" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?(/.*)?$ ]]; }
points_at_loopback() { [[ "$1" =~ (127\.0\.0\.1|localhost) ]]; }

check_duplicates() { # $1=label $2=file
  local label="$1" f="$2" dupes
  [[ -f "$f" ]] || return 0
  dupes="$(raw_pairs "$f" 2>/dev/null | cut -d= -f1 | sort | uniq -d)"
  if [[ -n "$dupes" ]]; then
    while IFS= read -r key; do
      blocked "$label: '$key' is defined more than once in $(basename "$f") -- remove all but one definition. Dotenv-style loaders silently take the LAST line, which may not be the one an operator intended; never assume which one is active."
    done <<< "$dupes"
  else
    ok "$label: no duplicate variable definitions"
  fi
}

check_file_security() { # $1=label $2=file
  local label="$1" f="$2"
  if [[ ! -f "$f" ]]; then
    blocked "$label: $f does not exist"
    return
  fi
  local perms; perms="$(stat -c '%a' "$f" 2>/dev/null || echo unknown)"
  if [[ "$perms" == "640" || "$perms" == "600" ]]; then
    ok "$label: permissions are $perms"
  else
    blocked "$label: permissions are $perms -- expected 640 or 600 (sudo chmod 640 $f)"
  fi
  if [[ "$SKIP_OWNERSHIP" != "1" ]]; then
    local og; og="$(stat -c '%U:%G' "$f" 2>/dev/null || echo unknown)"
    if [[ "$og" == "root:atlas" ]]; then
      ok "$label: ownership is root:atlas"
    else
      blocked "$label: ownership is $og -- expected root:atlas (sudo chown root:atlas $f)"
    fi
  fi
}

require_present() { # $1=label $2=file $3=key $4=kind(blocked|owner) $5=hint
  local label="$1" f="$2" key="$3" kind="${4:-blocked}" hint="${5:-}"
  local st; st="$(status_of "$f" "$key")"
  if [[ "$st" == "PRESENT" ]]; then
    ok "$label: $key is PRESENT"
    return 0
  fi
  if [[ "$kind" == "owner" ]]; then
    owner_ "$label: $key is EMPTY -- must be supplied from an external system/the owner; it cannot be inferred or generated locally. $hint"
  else
    blocked "$label: $key is EMPTY -- required. $hint"
  fi
  return 1
}

# ===========================================================================
section "1. File existence, permissions, ownership"
# ===========================================================================
check_file_security "control-plane.env" "$CP_ENV"
check_file_security "admin.env"         "$ADMIN_ENV"
check_file_security "worker.env"        "$WORKER_ENV"

# ===========================================================================
section "2. Duplicate variable definitions"
# ===========================================================================
check_duplicates "control-plane.env" "$CP_ENV"
check_duplicates "admin.env"         "$ADMIN_ENV"
check_duplicates "worker.env"        "$WORKER_ENV"

# ===========================================================================
section "3. NODE_ENV must be explicitly 'production' in every service"
# ===========================================================================
# Real gap this closes: @atlas/config's Zod schema defaults NODE_ENV to
# "development" when unset. If an operator forgets to set it in worker.env,
# assertProductionSecrets()/assertNotExampleSecrets() NEVER run and the
# worker can start with missing or placeholder secrets without any error.
for pair in "control-plane.env:$CP_ENV" "admin.env:$ADMIN_ENV" "worker.env:$WORKER_ENV"; do
  label="${pair%%:*}"; f="${pair#*:}"
  get_value "$f" "NODE_ENV"
  if [[ "$VALUE_OUT" == "production" ]]; then
    ok "$label: NODE_ENV=production"
  else
    blocked "$label: NODE_ENV is '${VALUE_OUT:-<empty>}', not the literal string 'production' -- required for every production-secret check in this system to actually run."
  fi
done

# ===========================================================================
section "4. Control Plane — required values, token relationships, URLs"
# ===========================================================================
require_present "control-plane.env" "$CP_ENV" "CONTROL_PLANE_PORT"
require_present "control-plane.env" "$CP_ENV" "HOST"
get_value "$CP_ENV" "HOST"
if [[ -n "$VALUE_OUT" && "$VALUE_OUT" != "127.0.0.1" ]]; then
  blocked "control-plane.env: HOST is not 127.0.0.1 -- ADR-021 requires loopback-only binding; the reverse proxy is the sole ingress."
fi

CP_TOKEN_STATUS="$(status_of "$CP_ENV" "ATLAS_CONTROL_PLANE_TOKEN")"
require_present "control-plane.env" "$CP_ENV" "ATLAS_CONTROL_PLANE_TOKEN" blocked \
  "This is the OPERATOR token. Run deploy/generate-tokens.sh to generate it safely (it will never overwrite an existing value)."
CP_OWNER_STATUS="$(status_of "$CP_ENV" "ATLAS_CONTROL_PLANE_OWNER_TOKEN")"
require_present "control-plane.env" "$CP_ENV" "ATLAS_CONTROL_PLANE_OWNER_TOKEN" blocked \
  "This is the OWNER/root token and MUST differ from the operator token. Run deploy/generate-tokens.sh."

if [[ "$CP_TOKEN_STATUS" == "PRESENT" && "$CP_OWNER_STATUS" == "PRESENT" ]]; then
  get_value "$CP_ENV" "ATLAS_CONTROL_PLANE_TOKEN"; cp_tok_hash="$(hash_of "$VALUE_OUT")"
  get_value "$CP_ENV" "ATLAS_CONTROL_PLANE_OWNER_TOKEN"; cp_owner_hash="$(hash_of "$VALUE_OUT")"
  if [[ "$cp_tok_hash" == "$cp_owner_hash" ]]; then
    blocked "control-plane.env: ATLAS_CONTROL_PLANE_TOKEN and ATLAS_CONTROL_PLANE_OWNER_TOKEN are IDENTICAL -- operator and owner authority must be distinct values. Never reuse one for both."
  else
    ok "control-plane.env: operator and owner tokens are DISTINCT"
  fi
fi

get_value "$CP_ENV" "WEB_ORIGIN"
if [[ -z "$VALUE_OUT" ]]; then
  owner_ "control-plane.env: WEB_ORIGIN is EMPTY -- must be the production apps/web origin (its Vercel deployment URL or custom domain), used for CORS. This cannot be inferred from the repository."
elif points_at_loopback "$VALUE_OUT"; then
  blocked "control-plane.env: WEB_ORIGIN points at localhost/127.0.0.1 -- this must be the real, public production apps/web origin, never a loopback address, for CORS to mean anything in production."
elif ! is_https_url "$VALUE_OUT"; then
  blocked "control-plane.env: WEB_ORIGIN is not a valid https:// URL."
else
  ok "control-plane.env: WEB_ORIGIN is a valid https production origin"
fi

get_value "$CP_ENV" "ATLAS_API_URL"
if [[ -z "$VALUE_OUT" ]]; then
  owner_ "control-plane.env: ATLAS_API_URL is EMPTY -- must be the production apps/api deployment on Vercel (the outbound audit-sync target). This cannot be inferred from the repository."
elif points_at_loopback "$VALUE_OUT"; then
  blocked "control-plane.env: ATLAS_API_URL points at localhost/127.0.0.1 -- this MUST NOT be the Control Plane's own address (that would be a self-referential, meaningless audit-sync target). It must be the public apps/api URL."
elif ! is_https_url "$VALUE_OUT"; then
  blocked "control-plane.env: ATLAS_API_URL is not a valid https:// URL -- required for outbound audit-sync to the canonical hash-chain."
else
  ok "control-plane.env: ATLAS_API_URL is a valid https production URL, distinct from the Control Plane's own address"
fi

get_value "$CP_ENV" "ATLAS_CP_AUDIT_SYNC"
if [[ -n "$VALUE_OUT" && "$VALUE_OUT" != "0" && "$VALUE_OUT" != "1" ]]; then
  blocked "control-plane.env: ATLAS_CP_AUDIT_SYNC must be '0' or '1' if set (got a non-boolean value)."
else
  ok "control-plane.env: ATLAS_CP_AUDIT_SYNC is valid (defaults to enabled if unset)"
fi

# ===========================================================================
section "5. Admin — required values, loopback URL, token match"
# ===========================================================================
require_present "admin.env" "$ADMIN_ENV" "ADMIN_PORT"
get_value "$ADMIN_ENV" "HOST"
if [[ -n "$VALUE_OUT" && "$VALUE_OUT" != "127.0.0.1" ]]; then
  blocked "admin.env: HOST is not 127.0.0.1 -- ADR-021 requires loopback-only binding."
fi

get_value "$ADMIN_ENV" "ATLAS_CONTROL_PLANE_URL"
if [[ -z "$VALUE_OUT" ]]; then
  blocked "admin.env: ATLAS_CONTROL_PLANE_URL is EMPTY -- required, and must be http://127.0.0.1:<control-plane-port> (same-host loopback traffic only)."
elif ! is_loopback_http_url "$VALUE_OUT"; then
  blocked "admin.env: ATLAS_CONTROL_PLANE_URL ('$VALUE_OUT' -- shown because this is a routing address, not a secret) is not a loopback http:// URL. Admin must reach Control Plane over 127.0.0.1 only, per ADR-021; it must never point off-host."
else
  ok "admin.env: ATLAS_CONTROL_PLANE_URL is a valid loopback address"
fi

ADMIN_TOKEN_STATUS="$(status_of "$ADMIN_ENV" "ATLAS_CONTROL_PLANE_TOKEN")"
require_present "admin.env" "$ADMIN_ENV" "ATLAS_CONTROL_PLANE_TOKEN" blocked \
  "Must equal control-plane.env's ATLAS_CONTROL_PLANE_TOKEN exactly (the OPERATOR token, never the owner token)."

if [[ "$ADMIN_TOKEN_STATUS" == "PRESENT" && "$CP_TOKEN_STATUS" == "PRESENT" ]]; then
  get_value "$ADMIN_ENV" "ATLAS_CONTROL_PLANE_TOKEN"; admin_hash="$(hash_of "$VALUE_OUT")"
  get_value "$CP_ENV" "ATLAS_CONTROL_PLANE_TOKEN"; cp_hash="$(hash_of "$VALUE_OUT")"
  if [[ "$admin_hash" == "$cp_hash" ]]; then
    ok "admin.env <-> control-plane.env: ATLAS_CONTROL_PLANE_TOKEN MATCH"
  else
    blocked "admin.env <-> control-plane.env: ATLAS_CONTROL_PLANE_TOKEN MISMATCH -- Admin cannot authenticate to Control Plane, and the nginx auth snippet (which must carry the same value) will also be wrong. Copy control-plane.env's operator token into admin.env exactly."
  fi
elif [[ "$ADMIN_TOKEN_STATUS" == "EMPTY" || "$CP_TOKEN_STATUS" == "EMPTY" ]]; then
  blocked "admin.env <-> control-plane.env: ATLAS_CONTROL_PLANE_TOKEN comparison MISSING -- cannot confirm a match until both are set."
fi

# ===========================================================================
section "5b. nginx auth snippet — must carry the same operator token"
# ===========================================================================
# Overridable so deploy/validate-production-env.test.sh can exercise this
# section against a disposable fixture instead of the real system path.
# Production runs always use the real default -- this never changes
# production behavior.
NGINX_SNIPPET="${ATLAS_NGINX_SNIPPET:-/etc/nginx/snippets/atlas-admin-auth.conf}"
if [[ -f "$NGINX_SNIPPET" ]]; then
  if grep -q '__TOKEN__' "$NGINX_SNIPPET" 2>/dev/null; then
    blocked "nginx auth snippet still has the __TOKEN__ placeholder -- replace it with the operator token, then 'nginx -t' and reload."
  else
    # Captured via command substitution (which strips the trailing newline
    # that grep/sed emit) and hashed with the SAME hash_of() helper used for
    # every other token comparison in this script -- hashing the raw piped
    # stream directly against a value hashed with `printf '%s'` would compare
    # "token\n" against "token" and always mismatch even on a true match.
    snippet_token="$(grep -oE 'Bearer [^"]*' "$NGINX_SNIPPET" 2>/dev/null | sed 's/^Bearer //')"
    snippet_hash="$(hash_of "$snippet_token")"
    if [[ -z "$snippet_token" ]]; then
      blocked "nginx auth snippet: token appears EMPTY."
    elif [[ "$CP_TOKEN_STATUS" == "PRESENT" ]]; then
      get_value "$CP_ENV" "ATLAS_CONTROL_PLANE_TOKEN"
      if [[ "$snippet_hash" == "$(hash_of "$VALUE_OUT")" ]]; then
        ok "nginx auth snippet token MATCHES control-plane.env's operator token"
      else
        blocked "nginx auth snippet token does NOT match control-plane.env's operator token -- the browser-facing Owner UI will get a stale/wrong bearer header. Update the snippet to the current operator token."
      fi
    fi
  fi
else
  owner_ "nginx auth snippet ($NGINX_SNIPPET) does not exist yet -- created by bootstrap.sh once a Tailscale IP is available."
fi

# ===========================================================================
section "6. Worker — delegate secret validation to the real, code-level validator"
# ===========================================================================
# Do NOT hand-roll DATABASE_URL/SUPABASE_*/ENCRYPTION_KEY/COOKIE_SECRET
# checks here -- @atlas/config's loadServerEnv() (assertProductionSecrets +
# assertNotExampleSecrets) is the single, already-tested source of truth for
# exactly this. We invoke the real, built module against the actual env
# file's contents, in a throwaway subshell, and report only its verdict.
WORKER_CONFIG_DIST="$ATLAS_ROOT/packages/config/dist/index.js"
if [[ ! -f "$WORKER_ENV" ]]; then
  blocked "worker.env does not exist."
elif [[ ! -f "$WORKER_CONFIG_DIST" ]]; then
  owner_ "Cannot delegate worker secret validation -- $WORKER_CONFIG_DIST is not built yet. Run the bootstrap build step first (this is expected before the first build completes)."
else
  # A temp .mjs FILE (not `node -e`) is used deliberately: Node's ESM loader
  # resolves bare specifiers (dotenv, zod, @atlas/shared) relative to the
  # importing module's own file:// URL, and eval'd (-e) scripts do not always
  # get a resolution base that walks the real on-disk node_modules chain.
  # The absolute file:// URL for WORKER_CONFIG_DIST avoids relative-path
  # ambiguity regardless of where this temp file happens to live.
  ATLAS_TMP_VALIDATOR="$(mktemp /tmp/atlas-validate-worker.XXXXXX.mjs)"
  cat > "$ATLAS_TMP_VALIDATOR" <<EOF_NODE
import { loadServerEnv } from "file://${WORKER_CONFIG_DIST}";
try {
  loadServerEnv(process.env, { loadEnvFile: false });
  console.log("VALID");
} catch (e) {
  console.log("INVALID: " + (e && e.message ? e.message : String(e)));
}
EOF_NODE
  # stderr is captured too (not discarded) so a failure to even RUN the
  # delegated validator -- e.g. a broken/incomplete node_modules install --
  # is distinguishable from the validator running and rejecting the env.
  # Collapsing both into one blank, generic BLOCKED line would violate the
  # "stop with a clear actionable error" requirement: an operator seeing a
  # bare "rejects it --" with nothing after it has no idea what to fix.
  worker_result="$(
    set -a
    # shellcheck disable=SC1090
    source "$WORKER_ENV" >/dev/null 2>&1
    set +a
    node "$ATLAS_TMP_VALIDATOR" 2>&1
  )"
  rm -f "$ATLAS_TMP_VALIDATOR"
  # Match the verdict on its own line rather than requiring the ENTIRE
  # captured output to equal "VALID" exactly: Node itself can emit an
  # unrelated warning to stderr alongside the real VALID/INVALID line (e.g.
  # an ExperimentalWarning, a deprecation notice on a future Node upgrade) --
  # an exact whole-string match would misreport that as a runtime failure
  # even though loadServerEnv() ran and returned a real verdict.
  worker_verdict="$(printf '%s\n' "$worker_result" | grep -E '^(VALID|INVALID:)' | tail -n1)"
  if [[ "$worker_verdict" == "VALID" ]]; then
    ok "worker.env: loadServerEnv() accepts it -- all required secrets present, none match the documented placeholder"
  elif [[ "$worker_verdict" == INVALID:* ]]; then
    # worker_result already carries only key NAMES (AtlasError messages list
    # missing/placeholder variable names, never values) -- safe to show.
    blocked "worker.env: loadServerEnv() rejects it -- ${worker_verdict#INVALID: }"
  else
    # The import/runtime itself failed before loadServerEnv() ever ran (e.g.
    # a missing/broken node_modules dependency such as dotenv, zod, or
    # @atlas/shared). This is a build/install problem, not a bad env value --
    # the raw Node error is safe to show verbatim because it names only
    # modules and file paths, never environment values.
    blocked "worker.env: could not run the delegated validator -- packages/config failed to load (this means the build/install is broken, not that worker.env itself is wrong). Run 'pnpm install && pnpm --filter @atlas/config build' and re-run this validator. Raw error: ${worker_result:-<no output>}"
  fi
fi

get_value "$WORKER_ENV" "ATLAS_QUEUE_PATH"
[[ -n "$VALUE_OUT" ]] && ok "worker.env: ATLAS_QUEUE_PATH is set (recommended -- keeps the durable queue outside the git checkout)" \
  || owner_ "worker.env: ATLAS_QUEUE_PATH is EMPTY -- not required (falls back to <repo>/.atlas/worker-queue.json) but recommended in production so a redeploy never clobbers in-flight jobs. Suggested: /var/lib/atlas/worker-queue.json (already covered by the systemd unit's ReadWritePaths)."
get_value "$WORKER_ENV" "ATLAS_REPO_ROOT"
[[ -n "$VALUE_OUT" ]] && ok "worker.env: ATLAS_REPO_ROOT is set" \
  || owner_ "worker.env: ATLAS_REPO_ROOT is EMPTY -- not required (falls back to process.cwd()) but recommended for clarity. Suggested: /opt/atlas."

# APP_NAME / PRODUCT_CODENAME are NOT required: packages/config/src/env.ts
# defaults them to "ArletOS"/"Atlas" respectively. Do not flag as missing.
ok "worker.env: APP_NAME / PRODUCT_CODENAME have safe repository-defined defaults (ArletOS / Atlas) if left unset"

# ===========================================================================
section "RESULT"
# ===========================================================================
printf '  %d passed, %d blocked, %d requiring owner input\n\n' "$PASS" "$BLOCKED" "$OWNER_INPUT"

if [[ "$BLOCKED" -gt 0 ]]; then
  echo "VERDICT: BLOCKED"
  echo "One or more locally-fixable misconfigurations exist (see BLOCKED lines above). Fix these before proceeding -- none of them require external input."
  exit 1
elif [[ "$OWNER_INPUT" -gt 0 ]]; then
  echo "VERDICT: REQUIRES OWNER INPUT"
  echo "Everything locally checkable is correct. The remaining items (see OWNER lines above) are values that must come from Vercel, Supabase, or the owner directly -- this script will not guess them."
  exit 2
else
  echo "VERDICT: READY"
  echo "All checks passed. Safe to proceed to the startup sequence in docs/deployment/private-plane.md."
  exit 0
fi
