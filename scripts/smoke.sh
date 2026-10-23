#!/usr/bin/env bash
# Smoke test: every API route must answer 200 with the expected content.
# Usage: scripts/smoke.sh http://localhost:8080     (or the deployed https://... URL)
set -u
BASE="${1:-}"
[ -z "$BASE" ] && { echo "usage: $0 BASE_URL" >&2; exit 2; }
BASE="${BASE%/}"
fail=0

check() {  # check <path> <text the body must contain>
  local path="$1" needle="$2" body code
  body="$(mktemp)"
  code="$(curl -s -m 60 -o "$body" -w '%{http_code}' "$BASE$path")" || code="000"
  if [ "$code" = "200" ] && grep -q "$needle" "$body"; then
    printf 'PASS  %s  %s\n' "$code" "$path"
  else
    printf 'FAIL  %s  %s  (expected 200 and body containing "%s")\n' "$code" "$path" "$needle"
    head -c 300 "$body"; echo
    fail=1
  fi
  rm -f "$body"
}

check "/"                                                "<div id=\"root\">"
check "/api/health"                                      '"ok"'
check "/api/warm"                                        '"warm"'
check "/precomputed/meta.json"                           '"first_day"'
check "/precomputed/accuracy.json"                       '"summary"'
check "/precomputed/decision/2026-01-15.json"            '"rows"'
check "/api/meta"                                        '"first_day"'
check "/api/decision?day=2026-01-15"                     '"rows"'
check "/api/accuracy"                                    '"summary"'
check "/api/accuracy?basis=all&min_h=24&max_h=36"        '"by_horizon"'

[ "$fail" = 0 ] && echo "ALL OK" || { echo "SMOKE TEST FAILED"; exit 1; }
