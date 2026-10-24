# OpenDots + OmniRoute — unified source monorepo

This repository combines the user-supplied **OpenDots** source and **OmniRoute 3.8.53** source.
It routes OpenDots's text and agent model calls to a *private* OmniRoute service without
removing the CopilotKit/AG-UI runtime that the existing chat UI depends on.

## Architecture

```text
Browser -> Vercel (OpenDots Vite frontend + streaming /api/* Edge proxy)
                  |
                  v  HTTPS OPENDOTS_BACKEND_ORIGIN
Always-on Docker host -> Caddy TLS -> OpenDots API :4310 -> OmniRoute :20128
                                     |                     |
                                persistent SQLite     provider accounts
                                     |
                                isolated browser :4311
```

**Vercel by itself is NOT a full OpenDots backend.** Background tasks, Playwright,
SQLite state, audio streams, long agent runs and persistent computers require
services that remain running. The Docker host needs a public HTTPS domain for
Vercel's API proxy and sufficient RAM/disk for OmniRoute (the source build is large).

## Repo layout

- `apps/opendots/` — original OpenDots app source (modified only as documented).
- `apps/omniroute/` — supplied OmniRoute v3.8.53 source, including backend/UI,
  binaries, tests, English docs and licenses. Large generated translations
  (`docs/i18n/`) are omitted from this distribution.
- `docker-compose.yml` — private AI network + Redis + browser service + Caddy.
- `deploy/Caddyfile` — HTTPS gateway to the long-running OpenDots API.
- `apps/opendots/api/[...path].js` — Vercel Edge streaming API proxy.
- `apps/opendots/vercel.json` — Vercel static front-end deployment settings.

## 1. Publish GitHub repo

Create a **private** blank repository (recommended), then:

```sh
git init
git branch -M main
git add .
git commit -m "Integrate OpenDots and OmniRoute"
git remote add origin https://github.com/YOUR_USERNAME/opendots-omniroute.git
git push -u origin main
```

Never commit a real `.env` or any SQLite file. Repo includes both source trees,
not the ~100k previously installed OpenDots `node_modules`.

## 2. Prepare persistent backend on Linux VPS / host

Install Docker Engine with Compose V2, point `agent.example.com` DNS A/AAAA to
the host, and allow inbound TCP ports **80 and 443**. Port **20128** is
loopback-only for SSH dashboard access. Protect VPS SSH.

```sh
cp .env.example .env
# Edit .env locally and generate secrets, e.g.:
openssl rand -hex 32   # OWNER_TOKEN
openssl rand -hex 32   # BROWSER_SECRET (DIFFERENT)
openssl rand -hex 32   # OMNIROUTE_WS_BRIDGE_SECRET
docker compose up -d --build
docker compose ps
```

Use a persistent Docker host with enough CPU/RAM (building OmniRoute from source
can be resource intensive). Caddy creates TLS once DNS/firewall are correct.

**OmniRoute dashboard:** open an SSH tunnel from your PC:

```sh
ssh -L 20128:127.0.0.1:20128 YOUR_VPS_USER@YOUR_VPS_IP
```

Then browse `http://127.0.0.1:20128/dashboard` to configure providers. The
gateway intentionally uses `REQUIRE_API_KEY=false` **only inside a private
Docker network**; its host-mapped port is loopback-only. Use *provider* API
credentials within the private OmniRoute dashboard. If you enable OmniRoute's
`REQUIRE_API_KEY=true`, generate the corresponding actual gateway token and set
`OMNIROUTE_API_KEY` to that token in the OpenDots container environment.

## 3. Vercel deployment

Connect the same GitHub repository to a Vercel project.

- **Root Directory:** `apps/opendots`
- **Framework:** Vite
- **Build Command:** `npm run build:web`
- **Output Directory:** `dist/client`
- **Environment Variable:** `OPENDOTS_BACKEND_ORIGIN=https://agent.example.com`
  (HTTPS origin only, no `/api` path or trailing suffix)
- **Node.js version:** 24.x for build.

Vercel is the frontend host. The `api/[...path].js` Edge function forwards
`/api/*` requests and streamed responses to your backend; it returns a clear 503
when the backend domain is not configured. Your `APP_ORIGIN` on the backend
must contain your Vercel site URL so OpenDots accepts browser-origin requests.

Do NOT set the server-side OmniRoute host to `localhost` in Vercel. It would
point to the Vercel sandbox rather than the running gateway.

## 4. Feature support and dependencies

| Feature | Integrated status / additional requirement |
| --- | --- |
| Standard OpenDots UI, chat, pages, tools | Existing components preserved |
| Text model routing | Configured to use private OmniRoute `auto` |
| Provider failover | Depends on configured OmniRoute providers & model/tool compatibility |
| Copilot floating Inspector widget | Disabled (`enableInspector={false}`) |
| Development promo sidebar link | Removed |
| Browser search | `WEB_SEARCH_PROVIDER=parallel` enables Parallel MCP search, if available |
| Browser URL reading | Browser worker included, choose `WEB_SEARCH_PROVIDER=browser` if needed |
| Scheduled tasks | Backend is always-on; depends on working model/config |
| Conversation database | Persistent Docker named volume; not shared via Vercel |
| Voice calls | Requires separate `VOICE_API_KEY` and `VOICE_MODEL`; not provided by OmniRoute |
| CopilotKit learned skills / hosted channels | Require optional CopilotKit Intelligence account |
| Composio connections | Require `COMPOSIO_API_KEY` + connected accounts |
| Persistent OpenBot computers / full desktop browsing | Requires separate Docker/OpenBot supervisor setup in `apps/opendots/docs/COMPUTERS.md`; **not auto-provisioned** |
| Slack channels | Separate Slack + hosted Intelligence setup |

Provider free-tier quotas are NOT automatically granted. Each provider is subject
to its own eligibility, quota and terms.

## 5. Validation

```sh
node --test tests/*.test.mjs
node --check 'apps/opendots/api/[...path].js'
docker compose config
```

Full OpenDots/Vite typechecking needs a Node 24 install with network access:

```sh
cd apps/opendots
npm ci
npm run typecheck
npm run build:web
npm test
```

Building OmniRoute from uploaded source likewise needs package dependencies,
native modules and enough RAM. Running integration E2E tests additionally needs
configured provider accounts, tokens, DNS/TLS and a running backend.

## Security

Keep OmniRoute and its Redis network private. Do not publish port 20128 to the
Internet. Guard OpenDots with `OWNER_TOKEN` (24+ characters), secure HTTPS, and
use distinct browser tokens. Never commit provider keys or production DBs.
Avoid exposing arbitrary internet-connected autonomous computers without
manual authorization/isolated sandboxing.

## Upstream notices

OpenDots and OmniRoute are third-party projects. Their original LICENSE
and associated notices are retained within each `apps/` tree.
