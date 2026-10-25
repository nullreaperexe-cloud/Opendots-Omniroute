# OpenDots website → FreeLLMAPI Unified API key (Groq removed)

FreeLLMAPI is a LOCAL-FIRST OpenAI-compatible AI router, NOT a hosted free
provider. Its Unified API Key authenticates the FreeLLMAPI service you run.
You must also configure free provider credentials inside the FreeLLMAPI
dashboard's Providers tab.

## No-Docker one-click setup for your FreeLLMAPI Windows desktop

If the FreeLLMAPI dashboard on your own Windows computer says
`http://127.0.0.1:31415/v1`, Vercel cannot reach it directly.
This repo has a **restricted local bridge** (only chat completions; never
admin/dashboard) and a preconfigured Tailscale Funnel route.

1. On your PC, open the FreeLLMAPI desktop app and sign in to Tailscale.
2. Download or `git pull` the latest OpenDots GitHub repo.
3. In Windows Explorer, **double-click**:
   `deploy/Connect-FreeLLMAPI.cmd`.
   There are no commands to type and Docker is not required.
4. The launcher checks both apps and starts the restricted bridge on
   `127.0.0.1:31416`. It mounts a separate Tailscale Funnel path
   `/freellmapi` without changing the existing root route for OpenDots.
5. In Vercel Production set:
   - `FREELLMAPI_API_KEY` = your **full private Unified API Key**
   - `FREELLMAPI_BASE_URL` =
     `https://kanish.tail7524cf.ts.net/freellmapi/v1`
   - optional `FREELLMAPI_MODEL=auto`
6. Save, then redeploy Production and send a test chat message.

The bridge passes the Unified Key through to **your local FreeLLMAPI**
for authentication and **does not** store it. Your dashboard and other
administrative routes are not exposed through the bridge. Tailscale Funnel
itself creates a public entry point, so keep your Unified Key secret. Always
review Tailscale configuration and avoid exposing the desktop app directly.

**PC must be ON:** The launcher does not turn local FreeLLMAPI into a hosted
cloud service. When PC/FreeLLMAPI/Tailscale is off, Groq-free OpenDots chat
will remain offline; use a hosted provider or another always-on machine for
24/7 access.

## Secure one-time setup in Vercel (no commands on the device viewing website)

1. Open the locally running FreeLLMAPI app → Keys → Unified API key → Copy.
   Keep this key private. Do not paste it in GitHub, chat, or VITE_* variables.
2. Go to https://vercel.com/dashboard, open the OpenDots project,
   then Settings → Environment Variables → Add New.
3. Add the following *Production* variables:

| Name | Value |
| --- | --- |
| FREELLMAPI_API_KEY | The full key, which normally begins with freellmapi- |
| FREELLMAPI_BASE_URL | Public HTTPS URL of your *running FreeLLMAPI router*, ending in /v1 |
| FREELLMAPI_MODEL | auto (optional; uses the router's own fallback routing) |

4. Save; redeploy Production to activate the new environment variables.
5. Check https://opendots-omniroute.vercel.app/api/instant-chat and then
   send a chat message through https://opendots-omniroute.vercel.app.

The health endpoint returns provider=freellmapi and configured=true when
both a key and acceptable HTTPS Base URL are configured. That does NOT mean
the router is online: a successful real chat request must be tested.

## Very important: screenshot URL is local, not internet-accessible

The FreeLLMAPI screenshot shows **http://127.0.0.1:31415/v1**.
127.0.0.1 means THE COMPUTER RUNNING FreeLLMAPI, never the remote Vercel server.
Do NOT put it into FREELLMAPI_BASE_URL on Vercel. The Vercel function rejects
plain HTTP, localhost, IP literals, invalid URL paths and URLs with credentials.

To use FreeLLMAPI from the deployed public website, you need a secure
public HTTPS endpoint pointed to your live router (through an authenticated
tunnel or reverse proxy). Do not expose the FreeLLMAPI dashboard/admin
publicly. Restrict access and protect unified-key credentials. Exposing an
API on the public Internet has abuse and free-tier quota risks.

If you run the Windows desktop application, it must remain running, and its
host must be ON for the endpoint to work. A secure HTTPS tunnel does not make
the Windows program operate when the laptop is OFF. For always-on requests
with laptop OFF, move the FreeLLMAPI service and its database/provider keys
to separate always-on infrastructure, or use a directly hosted provider key.

You can still run the original *local backend* directly against your router
using its local URL. Its server already accepts FREELLMAPI_API_KEY,
FREELLMAPI_BASE_URL and FREELLMAPI_MODEL. That local mode is different from
the Vercel website's serverless endpoint.

## Cloud UI capabilities

Preserved: original Dots-styled UI, recent conversations stored in the
browser, optional browser-based speech call fallback, and stateless public
HTTPS webpage reading. The voice fallback uses browser speech APIs, and is
not OpenAI Realtime/WebRTC calling.

Not provided by a unified key: a remote full Chromium computer, background
autonomous actions, a persistent session or an always-on model provider.
All free provider quotas remain governed by each upstream provider's policy.

Reference: https://github.com/tashfeenahmed/freellmapi
