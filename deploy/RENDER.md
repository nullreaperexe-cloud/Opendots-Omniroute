# Deploying OpenDots + OmniRoute on Render

The repository now includes a Render Blueprint at `render.yaml`. It defines:
- `opendots-runtime`: public API protected by a random generated `OWNER_TOKEN`, with persistent SQLite storage.
- `omniroute-runtime`: private AI gateway, with persistent provider configuration and routing data.
- `opendots-browser`: isolated Playwright browser worker. The random `BROWSER_SECRET` is shared with OpenDots using Render's secret reference.
- `omniroute-cache`: private Redis-compatible Key Value service.

## Billing approval required

**This Blueprint requests PAID Render compute, private services, and persistent disks.** It has *not* been synced/deployed by being committed to GitHub. Verify current Render pricing, billing limits, and explicit consent before provisioning. Free web hosting cannot provide the persistent, always-on services required here.

## Wiring

The `render-runtime` final stages make the original multi-stage Dockerfiles suitable for Render's default build behavior. Existing Docker Compose targets (`app`, `browser`, `runner-base`) are preserved. OpenDots resolves Render's actual private `hostport` references at runtime, rather than hardcoding a private hostname.

Use the existing Vercel project as the user-facing app. After the OpenDots Render web service successfully deploys, set this **server-side Vercel environment variable**:

```dotenv
OPENDOTS_BACKEND_ORIGIN=https://<your-actual-opendots-runtime>.onrender.com
```

Redeploy the Vercel app after adding the variable. Do **not** include `/api` in the value and never invent an endpoint before Render creates it. Unlock OpenDots using the generated `OWNER_TOKEN` inside the authorized Render environment.

OmniRoute deliberately remains a private service. Configure its eligible provider accounts through private shell/SSH port forwarding rather than exposing the dashboard to the public internet. Until providers are configured, the AI may not be able to answer requests.

## Boundaries / acceptance tests

Render Blueprint provisioning does **not** automatically enable third-party connections such as voice, Composio, hosted CopilotKit Intelligence, or OpenBot persistent desktop computers. These require separate authenticated services, accounts and integrations. After deployment, verify browser, chat, tools, scheduled tasks, streaming, restarts and persistence with real credentials, and inspect runtime logs for failures.

Run local structure checks and existing tests before declaring features operational. Do not promise billions of free tokens; quotas depend on the providers connected to OmniRoute.
