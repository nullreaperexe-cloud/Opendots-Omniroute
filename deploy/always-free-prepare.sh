#!/usr/bin/env bash
# Prepare a self-hosted OpenDots/FreeLLMAPI stack on an eligible free VM.
# This script does NOT create or upgrade a cloud account, purchase anything,
# install Docker, create DNS records, or change a Vercel environment.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: bash deploy/always-free-prepare.sh BACKEND_DNS_NAME https://YOUR-VERCEL-SITE.vercel.app" >&2
  exit 2
fi
backend_dns=$1
vercel_origin=$2
if [[ ! "$backend_dns" =~ ^[a-zA-Z0-9.-]+$ || "$backend_dns" == *..* || "$backend_dns" == .* || "$backend_dns" == *. ]]; then
  echo "Invalid backend DNS hostname (no scheme, port, slash or whitespace)." >&2
  exit 2
fi
if [[ ! "$vercel_origin" =~ ^https://[a-zA-Z0-9.-]+$ ]]; then
  echo "Vercel origin must be https://hostname with no path or trailing slash." >&2
  exit 2
fi
if [[ ! -f docker-compose.yml || ! -f .env.example ]]; then
  echo "Run this from the repository root." >&2
  exit 2
fi
if [[ -e .env ]]; then
  echo ".env already exists; refusing to overwrite stored credentials." >&2
  exit 1
fi
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "Install Docker Engine and Docker Compose V2 first." >&2
  exit 1
fi
if ! command -v openssl >/dev/null; then
  echo "OpenSSL is required for generating random secrets." >&2
  exit 1
fi

umask 077
owner_token=$(openssl rand -hex 32)
browser_secret=$(openssl rand -hex 32)
cat > .env <<EOF
# Generated privately on the host. Never upload/commit/share this file.
OWNER_TOKEN=$owner_token
BROWSER_SECRET=$browser_secret
FREELLMAPI_API_KEY=
FREELLMAPI_MODEL=auto:smart
FREELLMAPI_BASE_URL=http://freellmapi:3001/v1
AGENT_BACKEND_DOMAIN=$backend_dns
APP_ORIGIN=$vercel_origin,https://$backend_dns
WEB_SEARCH_PROVIDER=browser
EOF
chmod 600 .env
if ! docker compose config --quiet; then
  echo "Compose validation failed. Fix .env / Compose before starting." >&2
  exit 1
fi
echo "Private secrets generated. Building the 5-service backend on THIS host."
docker compose up -d --build
docker compose ps
echo "Backend origin to use in Vercel after HTTPS is verified: https://$backend_dns"
echo "Configure FreeLLMAPI unified key and start its Compose profile before AI chat."
echo "Keep the FreeLLMAPI admin dashboard private."
