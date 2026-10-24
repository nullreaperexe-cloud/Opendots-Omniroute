# ₹0 hosting plan: Oracle Cloud Always Free VM

**Objective:** Keep Vercel as the web frontend and run OpenDots API + OmniRoute + the isolated Playwright browser + Redis on **one Always Free eligible Linux VM**, with Docker Compose and persistent disk.

**Billing guardrail:** Do not create any resource unless the Oracle console labels it **Always Free Eligible**. Current OCI Ampere A1 free allocation (as of 2026-10) is **2 OCPUs / 12 GB RAM TOTAL**, shared across A1 instances, with 1,500 OCPU hours and 9,000 GB-hours monthly. Up to 200 GB total Always Free block volume (including boot volumes). The older 4 OCPU / 24 GB instructions are OUTDATED. Avoid changing to Pay As You Go, choosing GPU/paid shapes, or exceeding free quotas. Oracle requires a card for identity verification (temporary hold possible) but a Free Tier account is not billed for Always Free resources. Capacity may be unavailable in a given home region and idle instances may be reclaimed.

Official docs:
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://www.oracle.com/cloud/free/

## What is already prepared

- The existing root `docker-compose.yml` builds OpenDots, OmniRoute, isolated browser, Redis and Caddy on one Docker host.
- SQLite/OmniRoute data remain on Docker named volumes on the VM's durable boot disk.
- Public traffic reaches OpenDots only via HTTPS Caddy reverse proxy. OmniRoute dashboard is bound to `127.0.0.1:20128` and should NEVER be publicly exposed.
- Vercel UI remains at `https://opendots-omniroute-zeta.vercel.app`. Its `OPENDOTS_BACKEND_ORIGIN` must later equal the REAL, HTTPS backend origin.

## One-time setup once the free VM exists

1. Create an Oracle Cloud Free Tier account in your own control, never share its password/card details with a chatbot. In OCI console select the home-region `VM.Standard.A1.Flex` **Always Free** shape with **2 OCPUs / 12 GB RAM**, Ubuntu 24.04 LTS aarch64, and an Always Free eligible boot disk (e.g. 50 GB). If the free shape isn't available, stop instead of upgrading or selecting a paid shape.
2. Allocate a public IP and configure OCI security ingress TCP **80** and **443**, keep **22** limited to trusted IPs, and use SSH keys. On the VM allow the same through the OS firewall as appropriate.
3. Install Git, OpenSSL, Docker Engine and Docker Compose V2 from official Ubuntu/Docker instructions. Ensure `docker compose version` works and the sudo user has access. Avoid exposing the Docker socket to web users.
4. Clone the existing private repo: `git clone https://github.com/nullreaperexe-cloud/Opendots-Omniroute.git` with authorized GitHub authentication. `cd Opendots-Omniroute`.
5. Point an HTTPS-capable domain (including a free DNS service subdomain you control) to the VM's public IPv4. Configure `AGENT_BACKEND_DOMAIN` to that hostname. Caddy obtains TLS if its public ports and DNS are correct. If using `sslip.io` or other free DNS-based hostnames, verify current service behavior before trusting the address.
6. Generate a private `.env` from `.env.example`. Set `AGENT_BACKEND_DOMAIN`, `APP_ORIGIN=https://opendots-omniroute-zeta.vercel.app,https://<your-backend-host>` and independently generated 32+-character `OWNER_TOKEN`, `BROWSER_SECRET`, and `OMNIROUTE_WS_BRIDGE_SECRET`. Restrict permissions: `chmod 600 .env`. NEVER commit it or print it in logs/screenshots. Set `WEB_SEARCH_PROVIDER=browser` if you want browser-backed search.
7. Run `docker compose config`, then `docker compose up -d --build`. Builds may consume significant CPU/RAM, particularly OmniRoute and Chromium. Check `docker compose ps` and service logs until healthy. Verify `https://<your-backend-host>/api/...` from outside the VM.
8. Once the backend responds, update the existing Vercel project environment variable `OPENDOTS_BACKEND_ORIGIN=https://<your-backend-host>` for production/preview, and redeploy. Its value MUST be a reachable HTTPS origin, not localhost.
9. Configure real provider credentials through the private OmniRoute dashboard via an SSH tunnel `ssh -L 20128:127.0.0.1:20128 <ssh-user>@<vm-ip>`; then open `http://127.0.0.1:20128/dashboard`. Check provider compatibility with model `auto`.
10. Smoke-test chat, streaming, browser URL visits, saved threads after restart, scheduled agents, and browser-worker isolation. Optional voice, hosted CopilotKit and OpenBot computer integrations need additional provider accounts; they are NOT automatically enabled by free hosting.

### Reality check

Always Free *compute* is not the same as unlimited free AI model usage. Provider API tokens/quotas remain separately limited. ARM64 support/builds for OmniRoute native dependencies and Playwright must be verified on the actual VM. No live Oracle VM or backend has been provisioned by this commit.

## If no Oracle account / card is available

You can instead use a **computer you already own** as the always-on Docker host and securely publish ONLY the protected OpenDots API using Cloudflare Tunnel (free tier), keeping Vercel as frontend. Your computer must remain on and connected to internet; this isn't free electricity and is NOT highly available. A Cloudflare account and suitable hostname/domain are still needed for a stable tunnel. Never expose OmniRoute's private admin port publicly.

Render Free is **not** an equivalent substitute: idle spin-down, ephemeral local filesystem, and lack of free persistent disks break agent scheduling and local SQLite persistence.

Official Render free docs: https://render.com/docs/free
