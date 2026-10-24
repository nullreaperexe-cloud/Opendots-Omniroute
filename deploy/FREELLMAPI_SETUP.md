# OpenDots + FreeLLMAPI (private Windows Docker integration)

FreeLLMAPI is an optional, self-hosted OpenAI-compatible model gateway.
Its unified `freellmapi-...` key only authenticates the locally running router;
you must add eligible upstream provider keys in the FreeLLMAPI dashboard.

## Where do I enter the API key?

Use the **private root .env on the Windows hosting PC**:

`C:\Users\Kanish\opendots-omniroute\.env`

```dotenv
FREELLMAPI_API_KEY=freellmapi-REPLACE_WITH_YOUR_UNIFIED_KEY
FREELLMAPI_MODEL=auto:smart
FREELLMAPI_BASE_URL=http://freellmapi:3001/v1
```

**Never** paste credentials into the Vercel environment, frontend JS,
Vite `VITE_*` variables, GitHub, README, or chat. This Docker gateway and
OpenDots communicate over a private Docker network. The local dashboard is
available only on `http://127.0.0.1:3001`.

The safer method uses the secure PowerShell key prompt, so you do not need
to edit or print secrets.

## First-time steps on the Windows PC

1. Open CMD, make sure Docker Desktop is running:
   ```cmd
   cd /d C:\Users\Kanish\opendots-omniroute
   git pull origin main
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\deploy\Setup-FreeLLMAPI.ps1"
   ```
2. Open **http://127.0.0.1:3001** on the same Windows PC.
   Finish any dashboard registration/login, open **Keys**, and add your own
   eligible **provider API keys** (Groq, Gemini, etc.). The listed free-tier
   capacities are estimates and subject to each provider's limits and ToS.
3. From the FreeLLMAPI **Keys** page header, copy the **unified**
   `freellmapi-...` API key. This is a different key from your providers' keys.
4. In the same CMD, run:
   ```cmd
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\deploy\Connect-FreeLLMAPI-Key.ps1"
   ```
   Paste the unified key into the **hidden PowerShell prompt** (not chat).
   The script verifies the local models endpoint, edits only the private
   FreeLLMAPI entries, builds/restarts OpenDots without deleting any volumes.
5. Verify a real model completion and the existing Vercel/Tailscale API path:
   ```cmd
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\deploy\Test-OpenDots-Integration.ps1" -TestCompletion
   ```
   This deliberately never displays tokens or model answer text.
6. Refresh https://opendots-omniroute.vercel.app and test chat and one
   non-destructive tool call. Do not claim success solely from a model listing.

## Which model?

- `FREELLMAPI_MODEL=auto:smart` — prioritize capable models.
- `FREELLMAPI_MODEL=auto:fast` — prioritize low-latency models.
- `FREELLMAPI_MODEL=auto` — use your FreeLLMAPI configured fallback chain.

For **direct standalone OpenDots** (`npm run dev` outside Docker), set the
local base URL `http://127.0.0.1:3001/v1` in
`apps/opendots/.env`. For the existing **Docker** home deployment,
the root `.env` uses `http://freellmapi:3001/v1`, **not localhost**.

## Existing OmniRoute / rollback

The existing OmniRoute, Redis, browser, owner token, SQLite and volumes
remain untouched. `FREELLMAPI_API_KEY` takes priority **only if nonempty**.
To switch back, clear `FREELLMAPI_API_KEY=` in the private root `.env`,
then run `docker compose -f docker-compose.yml -f deploy/compose-home.yml
up -d --no-build --no-deps opendots`. There is no database wipe.
The Windows home bootstrap conditionally starts the FreeLLMAPI service only
when the FreeLLMAPI key is configured.

## Limitations

- This does **not** give OpenDots 24/7 availability when your PC is shut down.
  Both the OpenDots backend and FreeLLMAPI are currently running on that PC.
- FreeLLMAPI supplies **routing**, not free upstream tokens or a hosted API.
  The advertised 7.4B/month is a rough sum of eligible provider free tiers,
  not a guaranteed personal allowance.
- Voice WebRTC remains separate; FreeLLMAPI text chat does not automatically
  replace the realtime voice provider.
- Browser automation and overnight tasks still require the existing OpenDots
  computer/worker runtime to remain available, with enabled permissions.
- Secure, single-user, personal experimentation only; do not expose the
  FreeLLMAPI dashboard/API directly to the public internet.

Official sources:
- https://github.com/tashfeenahmed/freellmapi
- https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/install/01-install.md
- https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/api/01-rest-api.md
