#!/bin/sh
# The deployed runs. One-time steps, from this folder:
#   cf auth login --scopes challenge-widgets.write workers-scripts.write workers-scripts.read workers-tail.read
#   cf deploy --secrets-file .dev.vars     # reads cloudflare.config.ts; POC_KEY comes from .dev.vars
# Then: URL=wss://throwingwood-rooms-poc.<subdomain>.workers.dev ./driver/run-deployed.sh
# Budget (computed from the local runs): about 2,000 billed DO requests, under 2,000 SQLite rows
# written and about 300 GB-s for the whole session, each under 3% of the Free plan's daily limit.
set -e
cd "$(dirname "$0")/.."
: "${URL:?set URL to the wss:// workers.dev address}"
D="node driver/driver.mjs --url $URL"
$D --scenario rtt --label cf-rtt
$D --scenario turns --players 12 --observers 20 --duration 300 --label cf-turns-32
$D --scenario turns --players 12 --observers 100 --duration 300 --label cf-turns-112
$D --scenario idle --players 12 --observers 20 --idle-sec 30 --label cf-idle-32
$D --scenario resume --players 12 --observers 20 --duration 30 --label cf-resume-32
$D --scenario simul --players 12 --observers 20 --rounds 10 --label cf-simul-32
$D --scenario order --players 12 --observers 20 --duration 90 --label cf-order-32
$D --scenario replay --players 12 --observers 20 --replay-cap-sec 600 --label cf-replay-32
# A deploy 40 s into a 7-minute run. cf has no code_update_strategy setting, so the new
# code reaches the busy room on Cloudflare's default deferred schedule (about 300 s).
# POC_VERSION is bumped so /health shows when the new code is live; put back afterwards.
$D --scenario turns --players 12 --observers 20 --duration 420 --exec-at 40 \
  --exec "sed -i '' 's/POC_VERSION: bindings.text(\"1\")/POC_VERSION: bindings.text(\"2\")/' cloudflare.config.ts && cf deploy --secrets-file .dev.vars </dev/null >/dev/null" \
  --label cf-redeploy-32
sed -i '' 's/POC_VERSION: bindings.text("2")/POC_VERSION: bindings.text("1")/' cloudflare.config.ts
