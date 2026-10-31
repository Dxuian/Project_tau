#!/usr/bin/env bash
# Project Tau's alerts, run by .github/workflows/alerts.yml every 15 minutes.
# Each failing check is an open GitHub issue (label "alert") that names the
# cause and mentions the repo owner, so GitHub notifies them once when it
# starts; it is closed, with a comment, once the check passes again. The repo
# is public, so these issues and this job's log hold causes and counts only.
#
#   the payout service   GET /health answers ok, and canPay (its words are set)
#   the website          its home page, and /api/address (the site reaching the payout service)
#   PostHog              with the POSTHOG_READ_KEY secret: in the last 20 minutes, blocks found by
#                        visitors, errors in visitors' browsers, "mining unavailable" shown,
#                        over 10 mining errors
#
# DRY_RUN=1 prints what it would do with issues instead of doing it.
set -uo pipefail

PAYOUT_URL=${PAYOUT_URL:-https://project-tau.deathxunnat.workers.dev}
SITE_URL=${SITE_URL:-https://tau-site.deathxunnat.workers.dev}
POSTHOG_QUERY_URL=${POSTHOG_QUERY_URL:-https://us.posthog.com/api/projects/548451/query/}
WINDOW_MINUTES=20
OWNER=${GITHUB_REPOSITORY_OWNER:-owner}
REPO=${GITHUB_REPOSITORY:-}
RUN_URL=${GITHUB_SERVER_URL:-https://github.com}/${REPO}/actions/runs/${GITHUB_RUN_ID:-0}
NOW=$(date -u '+%Y-%m-%d %H:%M UTC')

declare -A TITLE=(
  [payout-down]="the payout service is down"
  [payout-cannot-pay]="the payout service can't pay"
  [site-down]="the website is down"
  [site-cannot-reach-payout]="the website can't reach the payout service"
  [block-found]="a visitor's miner found a block"
  [browser-errors]="errors in visitors' browsers"
  [mining-unavailable]="visitors saw \"mining unavailable\""
  [mining-errors]="mining errors (over 10 in ${WINDOW_MINUTES} minutes)"
  [posthog-check-broken]="the PostHog check can't run"
  [test]="test alert"
)
declare -A FIRING=() # id -> what was seen
declare -A CHECKED=() # ids whose check ran this time: only these are opened or closed

fire() { FIRING[$1]=$2; echo "::warning::${TITLE[$1]}: $2"; }
checked() { for id in "$@"; do CHECKED[$id]=1; done; }

# fetch URL [curl args...]: sets STATUS (000 when unreachable) and BODY.
fetch() {
  local out
  if out=$(curl -sS -m 20 -w '\n%{http_code}' "$@" 2>&1); then
    STATUS=${out##*$'\n'}
    BODY=${out%$'\n'*}
  else
    STATUS=000
    BODY=${out%$'\n'*}
  fi
}
short() { tr -s '[:space:]' ' ' <<<"$1" | cut -c1-200; }

# The payout service.
checked payout-down payout-cannot-pay
fetch "$PAYOUT_URL/health"
if [[ $STATUS != 200 ]] || ! jq -e '.ok == true' >/dev/null 2>&1 <<<"$BODY"; then
  fire payout-down "GET /health: HTTP $STATUS $(short "$BODY")"
elif ! jq -e '.canPay == true' >/dev/null <<<"$BODY"; then
  fire payout-cannot-pay "GET /health says canPay is false: OWNER_MNEMONIC is missing or doesn't match TAU_OWNER_ADDRESS"
fi

# The website, and its calls to the payout service.
checked site-down site-cannot-reach-payout
fetch "$SITE_URL/"
if [[ $STATUS != 200 ]] || [[ $BODY != *"Project Tau"* ]]; then
  fire site-down "GET /: HTTP $STATUS"
fi
fetch "$SITE_URL/api/address"
if [[ $STATUS != 200 ]] || ! jq -e '.address | type == "string"' >/dev/null 2>&1 <<<"$BODY"; then
  fire site-cannot-reach-payout "GET /api/address: HTTP $STATUS $(short "$BODY")"
fi

# What visitors' pages reported to PostHog.
if [[ -n ${POSTHOG_READ_KEY:-} ]]; then
  checked posthog-check-broken block-found browser-errors mining-unavailable mining-errors
  query="select event, count() from events where properties.app = 'project-tau'"
  query+=" and event in ('blocks_seen', '\$exception', 'mining_unavailable', 'mining_error')"
  query+=" and timestamp > now() - interval ${WINDOW_MINUTES} minute group by event"
  fetch "$POSTHOG_QUERY_URL" -X POST -H "Authorization: Bearer $POSTHOG_READ_KEY" -H 'Content-Type: application/json' \
    --data "$(jq -n --arg q "$query" '{query: {kind: "HogQLQuery", query: $q}}')"
  if [[ $STATUS != 200 ]] || ! jq -e '.results | type == "array"' >/dev/null 2>&1 <<<"$BODY"; then
    fire posthog-check-broken "PostHog's query API answered HTTP $STATUS (is POSTHOG_READ_KEY a personal key with query:read on project 548451?)"
  else
    count() { jq -r --arg e "$1" '[.results[] | select(.[0] == $e) | .[1]] | add // 0' <<<"$BODY"; }
    # shellcheck disable=SC2016 # $exception is PostHog's event name, not a variable
    blocks=$(count blocks_seen) errors=$(count '$exception') unavailable=$(count mining_unavailable) mining=$(count mining_error)
    echo "PostHog, last ${WINDOW_MINUTES} minutes: blocks_seen $blocks, \$exception $errors, mining_unavailable $unavailable, mining_error $mining"
    ((blocks > 0)) && fire block-found "$blocks blocks_seen event(s) in the last ${WINDOW_MINUTES} minutes: see the Project Tau dashboard in PostHog"
    ((errors > 0)) && fire browser-errors "$errors error(s) in the last ${WINDOW_MINUTES} minutes: see Error tracking in PostHog (filter app = project-tau)"
    ((unavailable > 0)) && fire mining-unavailable "$unavailable visitor(s) in the last ${WINDOW_MINUTES} minutes"
    ((mining > 10)) && fire mining-errors "$mining in the last ${WINDOW_MINUTES} minutes"
  fi
else
  echo "::notice::PostHog checks skipped: add the POSTHOG_READ_KEY secret (a PostHog personal API key with query:read) to turn them on"
fi

# A manual run with "test" ticked opens a test alert; any later run closes it.
checked test
if [[ ${TEST_ALERT:-} == true ]]; then fire test "a manual run asked for a test alert: this is what an alert looks like"; fi

# One open issue per firing check.
gh_() {
  if [[ -n ${DRY_RUN:-} ]]; then echo "would run: gh $*" | cut -c1-240; else gh "$@"; fi
}
if [[ -n ${DRY_RUN:-} ]]; then
  open='[]'
else
  gh label create alert --repo "$REPO" --color B60205 --description "Opened and closed by the Alerts workflow" --force >/dev/null || exit 1
  open=$(gh issue list --repo "$REPO" --label alert --state open --limit 100 --json number,body) || exit 1
fi
status=0
for id in "${!CHECKED[@]}"; do
  number=$(jq -r --arg m "<!-- alert:$id -->" '[.[] | select(.body | contains($m))][0].number // empty' <<<"$open")
  if [[ -n ${FIRING[$id]+set} ]]; then
    body=$(printf '@%s: %s.\n\n%s\n\nLast checked %s ([run](%s)). This issue closes by itself once the check passes; checks run every 15 minutes (.github/workflows/alerts.yml).\n\n<!-- alert:%s -->' \
      "$OWNER" "${TITLE[$id]^}" "${FIRING[$id]}" "$NOW" "$RUN_URL" "$id")
    if [[ -z $number ]]; then
      gh_ issue create --repo "$REPO" --title "Alert: ${TITLE[$id]}" --label alert --body "$body" || status=1
    else
      gh_ issue edit "$number" --repo "$REPO" --body "$body" >/dev/null || status=1
    fi
  elif [[ -n $number ]]; then
    gh_ issue close "$number" --repo "$REPO" --comment "Recovered: the check passed at $NOW ([run]($RUN_URL))." || status=1
  fi
done

summary="Checked at $NOW. Firing: ${#FIRING[@]}."
for id in "${!FIRING[@]}"; do summary+=$'\n'"- ${TITLE[$id]}"; done
echo "$summary"
[[ -n ${GITHUB_STEP_SUMMARY:-} ]] && echo "$summary" >>"$GITHUB_STEP_SUMMARY"
# Alerts reach the owner as issues; the run itself fails only when the issues couldn't be kept.
exit $status
