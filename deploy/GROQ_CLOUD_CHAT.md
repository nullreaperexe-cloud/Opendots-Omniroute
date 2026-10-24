# OpenDots Cloud Chat — GroqCloud, no CMD or Docker

This is an optional serverless cloud chat, not the full self-hosted OpenDots
computer agent. Vercel sends chat requests directly to GroqCloud through
Groq's OpenAI-compatible HTTPS API.

## One-time mobile browser key setup

1. Open https://console.groq.com/keys and sign in to GroqCloud.
2. Choose your Groq project, select Create API Key, name it OpenDots Chat,
   and securely copy the generated secret key.
3. In Vercel open the project opendots-omniroute > Environment Variables > Add New.
4. Set the name to GROQ_API_KEY and the value to your Groq key.
   Select Production and save it.
5. Redeploy the latest production commit to activate the new environment value.
6. Open https://opendots-omniroute.vercel.app and send Hello.

Never put your key in GitHub, chat, VITE_* client variables, or browser storage.
The old AI_GATEWAY_API_KEY is NOT used by Groq cloud chat.

## Check status

GET https://opendots-omniroute.vercel.app/api/instant-chat

Configured health returns JSON with provider = groq and configured = true.
This only shows whether a key exists. Sending a real message confirms Groq
has accepted the key and returned inference successfully.

## Models

By default the server tries:
- openai/gpt-oss-120b — more capable primary
- openai/gpt-oss-20b — fast fallback
- qwen/qwen3.8-27b — additional fallback

Optional Vercel production variable GROQ_MODEL=openai/gpt-oss-20b selects
the smaller/faster primary model. Only trusted supported model IDs are allowed.
No paid-tier upgrade or purchased credits are initiated by OpenDots.
Keep Groq on the Free plan to avoid usage charges. Free tier quotas apply.

Official API: https://console.groq.com/docs/openai
Models: https://console.groq.com/docs/models
Limits: https://console.groq.com/docs/rate-limits
Deprecations: https://console.groq.com/docs/deprecations

## Capabilities and limits

- PC OFF / Docker OFF: yes for chat.
- Serverless Vercel frontend and chat API: yes.
- Recent chat history: local browser only.
- Full autonomous browser, scheduled agents and synchronized memory: no.
  Those require a separate hosted runtime and persistent database.
- Shared free limits can be exhausted, especially if the site is public.
