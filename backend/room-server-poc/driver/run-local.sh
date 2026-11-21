#!/bin/sh
# Every scenario at 32 sockets against `npm run dev` (127.0.0.1:8799), each 2 minutes or less.
set -e
cd "$(dirname "$0")/.."
D="node driver/driver.mjs --url ws://127.0.0.1:8799 --players 12 --observers 20"
$D --scenario rtt --label local-rtt
$D --scenario turns --duration 110 --label local-turns-32
$D --scenario simul --rounds 10 --label local-simul-32
$D --scenario idle --idle-sec 30 --label local-idle-32
$D --scenario resume --duration 30 --label local-resume-32
$D --scenario replay --replay-cap-sec 110 --label local-replay-32
$D --scenario order --duration 50 --label local-order-32
# local stand-in for a deploy mid-match: bump POC_VERSION, wrangler dev reloads the Worker
$D --scenario turns --duration 100 --exec-at 40 --exec "sed -i '' 's/\"POC_VERSION\": \"[0-9]*\"/\"POC_VERSION\": \"2\"/' wrangler.jsonc" --label local-redeploy-32
sed -i '' 's/"POC_VERSION": "[0-9]*"/"POC_VERSION": "1"/' wrangler.jsonc
