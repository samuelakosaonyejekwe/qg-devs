#!/bin/sh
# Deploy from any workstation WITHOUT GitHub (recovery path if GitHub is unavailable):
#   ./deploy/deploy-local.sh fly        # build remotely on Fly from the local checkout
#   ./deploy/deploy-local.sh cloudflare # publish the static web mirror to Cloudflare Pages
#   ./deploy/deploy-local.sh compose    # run on this or any Docker host
set -eu
cd "$(dirname "$0")/.."
case "${1:-}" in
  fly)        flyctl deploy --remote-only ;;
  cloudflare) (cd web && npm ci && npm run build) && npx wrangler@3 pages deploy web/dist --project-name=qg-devs ;;
  compose)    docker compose up -d --build ;;
  *) echo "usage: $0 fly|cloudflare|compose" >&2; exit 2 ;;
esac
