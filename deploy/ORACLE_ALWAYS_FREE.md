# Optional always-on OpenDots hosting

This is an architectural reference, not an automatically provisioned VM.

OpenDots' full agent runtime, persistent SQLite and browser worker require an
always-running machine. The old OmniRoute application is no longer bundled.
For AI, configure a separately operating FreeLLMAPI router (and its upstream
provider keys) or an OpenRouter/OpenAI-compatible hosted provider.

Use only an explicitly eligible free VM and verify its current allowance,
availability, billing conditions, ARM compatibility and memory before
deployment. A VM cannot be assumed free or available. Never upgrade to a paid
shape or attach a payment method without understanding charges.

The optional `docker-compose.yml` contains OpenDots, browser, Redis,
Caddy and a FreeLLMAPI profile. Protect persistent volumes, owner tokens,
browser credentials and the FreeLLMAPI administration UI. Use HTTPS for
external endpoints, do not expose private ports, and keep provider credentials
outside the source repository.

Current cloud chat is a separate Vercel serverless frontend and does not
provision the router or a remote interactive browser on the VM.

Official references:
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://www.oracle.com/cloud/free/
