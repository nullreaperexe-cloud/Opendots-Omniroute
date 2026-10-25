# OpenDots + FreeLLMAPI on a Windows PC

This repo no longer includes OmniRoute. The domain and GitHub repository
still have the historical name `opendots-omniroute`.

## No-Docker desktop FreeLLMAPI connection

1. Open **FreeLLMAPI Desktop** on the Windows PC. Its local API typically
   listens on `http://127.0.0.1:31415/v1`.
2. Sign in to **Tailscale** on that PC.
3. With Node.js installed, double-click `deploy/Connect-FreeLLMAPI.cmd`.
   This starts the private loopback-only chat bridge and configures a separate
   `/freellmapi` Funnel path; it does not publish the FreeLLMAPI dashboard.
4. In Vercel Production, configure `FREELLMAPI_API_KEY` and
   `FREELLMAPI_BASE_URL=https://kanish.tail7524cf.ts.net/freellmapi/v1`.
   Redeploy Vercel to apply environment changes.
5. Visit `https://opendots-omniroute.vercel.app` and test a chat completion.

Keep the Windows PC, FreeLLMAPI desktop and Tailscale ON. An API key by
itself cannot make a local model router function with the laptop OFF.

## Optional isolated OpenDots backend

A separate OpenDots agent/browser runtime can be started from Docker Compose
with private data volumes and a local browser worker. It is not necessary for
the lightweight cloud chat. Set your private owner/browser credentials in
`.env` and use `deploy/Start-OpenDots-Home.ps1` if you intentionally run
that backend; FreeLLMAPI is an optional Compose profile.

Do not publish the FreeLLMAPI admin/dashboard endpoints to the Internet.
Tailscale Funnel is a public entry point; use a restricted chat bridge and
keep the Unified API Key secret. FreeLLMAPI provider usage is rate limited by
your upstream accounts, irrespective of hosting.
