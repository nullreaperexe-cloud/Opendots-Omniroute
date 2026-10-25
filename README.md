# OpenDots — FreeLLMAPI-first AI workspace

This repository keeps the OpenDots UI and agent application. The old OmniRoute
source tree and runtime were removed from `apps/`. The existing GitHub
repository name and Vercel domain are historical and do not mean OmniRoute is
installed.

## Repository

- `apps/opendots/`: original-style OpenDots UI, server and Vercel functions
- `deploy/freellmapi-bridge.mjs`: restricted chat-only bridge for the
  locally running FreeLLMAPI Windows desktop application
- `deploy/Connect-FreeLLMAPI.cmd`: double-click launcher (requires Windows,
  local FreeLLMAPI app, Node.js, and Tailscale already installed and online)
- `deploy/FREELLMAPI_UNIFIED_CLOUD_CHAT.md`: setup for the Vercel cloud chat
- `docker-compose.yml`: optional separate Docker deployment of OpenDots,
  browser, Redis, Caddy, and a FreeLLMAPI profile. Does not build OmniRoute.

## Vercel cloud chat

`https://opendots-omniroute.vercel.app`

The serverless chat uses **FreeLLMAPI Unified API Key**, not OmniRoute and not
Groq. Set the private Vercel **Production** variables:

- `FREELLMAPI_API_KEY` = the user's FreeLLMAPI Unified API Key
- `FREELLMAPI_BASE_URL` = public HTTPS FreeLLMAPI router ending in `/v1`
- `FREELLMAPI_MODEL` = `auto` (optional)

The FreeLLMAPI Windows desktop app listens on `127.0.0.1:31415`, which
cannot be called from Vercel. For the owner's existing Tailscale hostname, the
restricted bridge is configured at
`https://kanish.tail7524cf.ts.net/freellmapi/v1` when the Windows launcher
has been started. This only works while the Windows PC, Tailscale and
FreeLLMAPI desktop app are **ON**. The unified key authenticates the router,
not a hosted inference service. Upstream provider quotas still apply.

## Full OpenDots runtime (optional)

The full Dot agent and local isolated browser require an always-running
runtime and storage. Vercel chat alone cannot provide a persistent remote
Chromium computer or 24/7 autonomous work. Desktop browser-speech fallback and
stateless public-page research are separate features.

Docker Compose supports an optional FreeLLMAPI profile for self-hosting.
Set distinct private `OWNER_TOKEN`, `BROWSER_SECRET`, `APP_ORIGIN`, and
FreeLLMAPI provider credentials before running it. Do not commit `.env`,
publish the FreeLLMAPI admin dashboard, or expose owner credentials.

## Validation

- `node --test tests/*.test.mjs` from repository root
- `cd apps/opendots && npm ci --ignore-scripts && npm run verify:web`
- `docker compose --profile freellmapi config` when Docker is installed

No credentials are stored in this repository. Removing the OmniRoute source
does **not** remove old Docker volumes/containers or the old Git commit
history; these remain separate local resources.
