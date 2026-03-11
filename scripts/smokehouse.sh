#!/usr/bin/env bash
set -euo pipefail

SITE_BASE="${1:-${SITE_BASE_URL:-https://kaixusuperidev2.netlify.app}}"
WORKER_URL="${2:-${WORKER_URL:-}}"
WS_ID="${WS_ID:-primary-workspace}"

SITE_BASE="${SITE_BASE%/}"
if [[ -n "$WORKER_URL" ]]; then
  WORKER_URL="${WORKER_URL%/}"
fi

echo "SMOKEHOUSE :: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Site:   $SITE_BASE"
echo "Worker: ${WORKER_URL:-<not-set>}"
echo "SKYE:   release-visible via npm run check:skye-schema && npm run test:export-import-schema"
echo

pass=0
fail=0

check() {
  local name="$1"
  local method="$2"
  local url="$3"
  local body="${4:-}"
  local expected_extra="${5:-}"

  local code
  if [[ "$method" == "GET" ]]; then
    code=$(curl -L -sS -o /tmp/smoke.out -w "%{http_code}" --max-time 30 "$url" || true)
  else
    code=$(curl -L -sS -o /tmp/smoke.out -w "%{http_code}" --max-time 30 -X "$method" -H "Content-Type: application/json" --data "$body" "$url" || true)
  fi

  if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
    echo "PASS  $name :: $method $url -> $code"
    pass=$((pass+1))
  elif [[ -n "$expected_extra" && "$code" =~ $expected_extra ]]; then
    echo "PASS  $name :: $method $url -> $code (policy-protected expected)"
    pass=$((pass+1))
  else
    echo "FAIL  $name :: $method $url -> $code"
    head -c 220 /tmp/smoke.out | tr '\n' ' '; echo
    fail=$((fail+1))
  fi
}

check "Site Root" "GET" "$SITE_BASE/"
check "SkyeMail Surface" "GET" "$SITE_BASE/SkyeMail/index.html"
check "SkyeChat Surface" "GET" "$SITE_BASE/SkyeChat/index.html"
check "Neural Surface" "GET" "$SITE_BASE/Neural-Space-Pro/index.html"
check "Upgrade Notes Surface" "GET" "$SITE_BASE/upgrade-notes.html"
check "SkyeCalendar Surface" "GET" "$SITE_BASE/SkyeCalendar/index.html"
check "SkyeTasks Surface" "GET" "$SITE_BASE/SkyeTasks/index.html"
check "SkyeNotes Surface" "GET" "$SITE_BASE/SkyeNotes/index.html"
check "SkyeForms Surface" "GET" "$SITE_BASE/SkyeForms/index.html"
check "SkyeVault Surface" "GET" "$SITE_BASE/SkyeVault/index.html"
check "SkyeAnalytics Surface" "GET" "$SITE_BASE/SkyeAnalytics/index.html"

if [[ -n "$WORKER_URL" ]]; then
  check "Worker Health" "GET" "$WORKER_URL/health" "" "^(302|401|403)$"
else
  echo "SKIP  Worker Health :: WORKER_URL not provided"
fi

check "Generate API" "POST" "$SITE_BASE/api/kaixu-generate" "{\"ws_id\":\"$WS_ID\",\"prompt\":\"smokehouse ping\",\"activePath\":\"src/App.tsx\",\"files\":[]}" "^(401)$"
check "Auth Me API" "GET" "$SITE_BASE/api/auth-me" "" "^(401|403)$"

echo
echo "Summary: PASS=$pass FAIL=$fail"
echo "SKYE Contracts: canonical contract validity, secure roundtrip retention, tamper rejection, and passphrase enforcement are tracked by release gates outside HTTP smoke."
if [[ $fail -gt 0 ]]; then
  exit 1
fi
