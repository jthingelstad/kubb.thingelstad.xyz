#!/bin/sh
# Deploys the pitch server Worker with nobody at the machine: no 1Password, no prompt.
#
#   backend/pitch-server/deploy.sh production
#   backend/pitch-server/deploy.sh dev
#
# Where the secrets come from, and where they never go:
#
# - PUSH_SECRET, the HMAC key shared with the api function, is read from AWS Secrets
#   Manager (`throwing-wood/push-secret`, the authority: docs/PITCH-SERVER.md section 12)
#   as the cloud-engineer role, into this process's environment only. The secrets file
#   `cf deploy` is given holds a reference, `PUSH_SECRET=${PUSH_SECRET}`, which cf expands
#   from the environment, so the value is never written to disk, printed or logged.
# - DEV_KEY (dev only), the bearer key for /dev/pitch, the same way from
#   `throwing-wood/pitch-dev-key`. Without that secret a dev deploy is refused, since it
#   would take the key off the dev Worker.
# - Cloudflare: `CLOUDFLARE_API_TOKEN` from the environment when it is set; else from
#   Secrets Manager (`throwing-wood/cloudflare-deploy-token`) when that secret exists;
#   else the `cf auth login` already on this machine. A token needs Workers Scripts
#   edit on the account and nothing more.
#
# The README's `op inject` way still works for a person at the machine. This one is for
# an agent or a scheduled run. Bump the Worker's `version` in cloudflare.config.ts first.
set -eu

mode="${1:-}"
case "$mode" in
production | dev) ;;
*)
  echo "usage: deploy.sh production|dev" >&2
  exit 2
  ;;
esac

cd "$(dirname "$0")"
AWS_PROFILE="${AWS_PROFILE:-cloud-engineer}"
AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_PROFILE AWS_REGION

# A secret's value on stdout; nothing on stderr and a failure when it is not there.
secret() {
  aws secretsmanager get-secret-value --secret-id "$1" --query SecretString --output text 2>/dev/null
}

PUSH_SECRET="$(secret throwing-wood/push-secret)" || {
  echo "deploy: cannot read throwing-wood/push-secret as $AWS_PROFILE" >&2
  exit 1
}
[ -n "$PUSH_SECRET" ] || {
  echo "deploy: throwing-wood/push-secret is empty" >&2
  exit 1
}
export PUSH_SECRET

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  if token="$(secret throwing-wood/cloudflare-deploy-token)" && [ -n "$token" ]; then
    CLOUDFLARE_API_TOKEN="$token"
    export CLOUDFLARE_API_TOKEN
    echo "deploy: Cloudflare token from Secrets Manager"
  else
    echo "deploy: no Cloudflare token set; using this machine's cf login"
  fi
fi

# The file holds references only (see above). Its name is one .gitignore already covers.
vars="$(mktemp ./.prod.vars.unattended.XXXXXX)"
trap 'rm -f "$vars"' EXIT INT TERM
chmod 600 "$vars"

if [ "$mode" = production ]; then
  printf '%s\n' 'PUSH_SECRET=${PUSH_SECRET}' >"$vars"
  npx cf deploy --mode production --secrets-file "$vars" </dev/null
else
  DEV_KEY="$(secret throwing-wood/pitch-dev-key)" || {
    echo "deploy: no throwing-wood/pitch-dev-key in Secrets Manager; a dev deploy without it" >&2
    echo "        would take DEV_KEY off the dev Worker. Use the README's op inject way, or" >&2
    echo "        add the secret (README.md, \"Deploy with nobody there\")." >&2
    exit 1
  }
  [ -n "$DEV_KEY" ] || {
    echo "deploy: throwing-wood/pitch-dev-key is empty" >&2
    exit 1
  }
  export DEV_KEY
  printf '%s\n%s\n' 'PUSH_SECRET=${PUSH_SECRET}' 'DEV_KEY=${DEV_KEY}' >"$vars"
  npx cf deploy --secrets-file "$vars" </dev/null
fi
