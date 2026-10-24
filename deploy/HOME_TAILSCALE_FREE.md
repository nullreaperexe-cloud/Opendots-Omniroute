# OpenDots + OmniRoute — zero hosting bill on an existing Windows PC

This is the only currently selected ₹0 backend architecture without a paid VM:
- Vercel Hobby: already deployed React/Vite frontend.
- Windows PC (already owned): OpenDots API + OmniRoute gateway + Playwright browser + Redis run under Docker Desktop.
- Tailscale Funnel Personal (free for personal/noncommercial use): a stable, public HTTPS `*.ts.net` hostname proxies to the local OpenDots backend.
- Vercel's existing server-side Edge API proxy uses `OPENDOTS_BACKEND_ORIGIN=https://<device>.<tailnet>.ts.net`.

**Critical limitation:** This is **self-hosting, not cloud hosting**. Windows and Docker must remain running and connected. Electricity, hardware and internet are not free. The public URL only works while the computer and Funnel are online. No current change can make the PC run while switched off.

Tailscale's **Personal plan** is advertised as free indefinitely for individual/personal use, and Funnel is available on all plans. It requires a Tailscale account and enabling Funnel, but no cloud VM, card purchase, DNS zone or domain purchase is required. Its stable hostname has bandwidth limits. This is not equivalent to a production SLA.

References:
- https://tailscale.com/pricing
- https://tailscale.com/kb/1223/funnel
- https://tailscale.com/docs/reference/examples/funnel
- https://docs.docker.com/desktop/setup/install/windows-install/

## Local runtime

`deploy/compose-home.yml` publishes OpenDots on `127.0.0.1:4310` and retains OmniRoute on its base Compose loopback-only `127.0.0.1:20128` binding. Neither is reachable directly from the internet; Tailscale Funnel only exposes OpenDots. To prevent host port 80/443 bindings, **do not start Caddy** for PC mode.

**Permanent low-memory Docker solution:** Home Compose uses the upstream, version-pinned prebuilt image `diegosouzapw/omniroute:3.8.50` and `build: !reset null`. This explicitly removes the inherited heavy source `build:` declaration. Do **not** use `docker compose ... build omniroute` for this home profile; OmniRoute needs **no local Next.js build**. Versioned public images are published at https://hub.docker.com/r/diegosouzapw/omniroute/tags. This pins an older stable version rather than automatically following upstream updates; review and explicitly update the tag when needed.

Use the repeatable bootstrap (preserves existing `.env`):

```cmd
cd /d C:\\Users\\Kanish\\opendots-omniroute
powershell -NoProfile -ExecutionPolicy Bypass -File ".\\deploy\\Start-OpenDots-Home.ps1" -FunnelUrl "https://kanish.tail7524cf.ts.net" -VercelOrigin "https://opendots-omniroute.vercel.app"
```

Or start an already-bootstrapped stack directly (no compiling):

```powershell
docker compose -f docker-compose.yml -f deploy/compose-home.yml pull redis omniroute
docker compose -f docker-compose.yml -f deploy/compose-home.yml up -d --no-build redis omniroute browser opendots
```

Prepare a private `.env` first from `.env.example` with 32+ byte random owner/browser secret strings, set `AGENT_BACKEND_DOMAIN=localhost` (unused Caddy placeholder), set `APP_ORIGIN` to both the Vercel frontend and your exact Tailscale `https://<device>.<tailnet>.ts.net` origin, `WEB_SEARCH_PROVIDER=browser`, and make sure no production API key is committed. Tailscale's Windows program must be signed in to the Personal tailnet, with MagicDNS/HTTPS/Funnel enabled as documented. `tailscale funnel --bg 4310` publishes the local backend.

A PowerShell bootstrap is supplied as `deploy/Start-OpenDots-Home.ps1`. It securely generates `.env` if one doesn't already exist, **reuses existing secrets** on later runs, validates APP_ORIGIN, checks Docker and Tailscale, pulls prebuilt OmniRoute and Redis, builds only the smaller OpenDots/browser services and starts them. It cannot sign up for Tailscale, enable protected machine authorization by itself, or control whether Windows/Docker keep running. The upstream image includes the OmniRoute dashboard even though its port remains loopback-only. Models, provider accounts, and runtime behavior must still be checked independently.

## Live frontend wiring

Only **after** the Tailscale Funnel address has been created and verified, set the existing Vercel project's `OPENDOTS_BACKEND_ORIGIN` for Production and Preview to the exact HTTPS origin. Then redeploy and test:
1. /api GET and authenticated OpenDots session
2. AI model routed through OmniRoute with real provider account/quota
3. Browser URL reading and streaming
4. Scheduled tasks while Windows PC is awake
5. Conversation persistence after Docker restart

Vercel's proxy must preserve the browser's original `Origin` header and the owner auth flow. Until provider accounts are configured, AI chat may still fail. Voice, Composio, hosted CopilotKit Intelligence, and full persistent OpenBot desktops require their own accounts/services and are **not** guaranteed by this approach.

## Why not Cloudflare Quick Tunnel?

Quick Tunnels are free and accountless, but their URL changes after restart and Cloudflare documents **no Server-Sent Events (SSE) support**; this breaks streaming use cases and makes them a poor match for OpenDots's long agent streams:
https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/

## Alternative with no 24/7 PC

At present, no option has been verified that guarantees all requirements (24/7 persistent compute, browser sandbox, database persistence, zero bill, no card/sign-up, and no service restrictions). Free cloud services may sleep, limit resources or require billing verification. Do not provision paid Render/Northflank/Railway infrastructure on this user's behalf.
