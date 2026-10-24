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
check "/api/decision?day=2026-01-15&demand=25000&cost_ratio=5&margin_by=level&band_basis=all"  '"avg_buy_cover"'
check "/api/margin-check"                                '"achieved"'
check "/api/margin-check?cost_ratio=9&margin_by=flat"    '"compare"'
check "/precomputed/margin_check.json"                   '"achieved"'
check "/api/decision?day=2026-01-15&ramp_mw=800"         '"ramp_size"'
check "/api/recent-bias"                                 '"lowers_mae"'
check "/api/cutoff-compare"                              '"versions_utc"'
check "/precomputed/recent_bias.json"                    '"primary"'
check "/precomputed/cutoff_compare.json"                 '"rows"'
check "/api/baseline"                                    '"skill_mae"'
check "/api/baseline?start=2026-01-10&end=2026-01-20"    '"two_days_before"'
check "/precomputed/baseline.json"                       '"guesses"'
check "/api/decision?day=2026-01-15"                     '"how_wrong"'
check "/api/replay"                                      '"covered_share"'
check "/api/replay?cost_ratio=9&price_short=200&price_unused=20"  '"cost"'
check "/precomputed/replay.json"                         '"totals"'
check "/api/decision?day=2026-01-15&demand=25000"        '"what_if"'
check "/api/tradeoff"                                    '"avg_unused"'
check "/api/tradeoff?cost_ratio=4&margin_by=level"       '"current_ratio"'
check "/precomputed/tradeoff.json"                       '"rows"'

reject() {  # reject <path>: bad input must get HTTP 422
  local code
  code="$(curl -s -m 60 -o /dev/null -w '%{http_code}' "$BASE$1")" || code="000"
  if [ "$code" = "422" ]; then printf 'PASS  %s  %s (rejected as expected)\n' "$code" "$1"; else printf 'FAIL  %s  %s (expected 422)\n' "$code" "$1"; fail=1; fi
}
reject "/api/decision?day=2026-01-15&cost_ratio=50"
reject "/api/decision?day=2026-01-15&demand=-5"
reject "/api/margin-check?margin_by=hourly"
reject "/api/decision?day=2026-01-15&ramp_mw=10"
reject "/api/recent-bias?cutoff=9am"
reject "/api/baseline?start=2026-01-20&end=2026-01-10"
reject "/api/replay?price_short=200"
reject "/api/tradeoff?cost_ratio=40"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "SMOKE TEST FAILED"; exit 1; }
