// OpenDots serverless chat fallback. No home PC, Docker or browser-side API key.
// Uses Vercel's short-lived project OIDC token and ONLY zero-priced models.
// This does not provide autonomous computer/browser tools or persistent cloud memory.
const gateway = 'https://ai-gateway.vercel.sh/v1';
let freeCatalog = { expires: 0, models: [] };

function modelsAreFree(model) {
  return model && model.type === 'language' &&
    model.modalities?.input?.includes('text') &&
    model.modalities?.output?.includes('text') &&
    Number(model.pricing?.input) === 0 &&
    Number(model.pricing?.output) === 0 &&
    model.pricing?.input !== undefined &&
    model.pricing?.output !== undefined;
}
function rankedModels(models) {
  // Current list is fetched on the actual request: never spend on a paid model,
  // even if pricing or a promotion has changed since deployment.
  const rank = (m) => {
    const n = String(m.name || m.id).toLowerCase();
    if (n.includes('nemotron 3.5 lightning')) return 0;
    if (n.includes('nemotron')) return 1;
    if (n.includes('flash')) return 2;
    return 3;
  };
  return models.filter(modelsAreFree).sort((a,b) =>
    rank(a) - rank(b) || (b.context_window || 0) - (a.context_window || 0)
  ).map(x => x.id);
}
async function getFreeModels() {
  if (Date.now() < freeCatalog.expires && freeCatalog.models.length) return freeCatalog.models;
  const response = await fetch(gateway + '/models', {
    signal: AbortSignal.timeout(12000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('AI model catalog temporarily unavailable.');
  const data = await response.json();
  const models = rankedModels(Array.isArray(data.data) ? data.data : []);
  freeCatalog = { expires: Date.now() + 10 * 60 * 1000, models };
  return models;
}
function send(response, status, payload) {
  response.status(status)
    .setHeader('Cache-Control', 'no-store, private')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .json(payload);
}
function sameOrigin(request) {
  const origin = request.headers.origin;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!origin) return true; // Server-to-server health tools can omit Origin.
  try {
    const expected = new URL('https://' + request.headers.host);
    return new URL(origin).origin === expected.origin;
  } catch { return false; }
}
function validMessages(body) {
  if (!body || !Array.isArray(body.messages)) return null;
  if (body.messages.length < 1 || body.messages.length > 18) return null;
  let size = 0;
  const result = [];
  for (const m of body.messages) {
    if (!m || !['user','assistant'].includes(m.role) ||
        typeof m.content !== 'string' || !m.content.trim() || m.content.length > 2400) return null;
    size += m.content.length;
    if (size > 13000) return null;
    result.push({ role: m.role, content: m.content });
  }
  if (result.at(-1).role !== 'user') return null;
  return result;
}

/**
 * Classifies provider rejection without leaking raw gateway responses,
 * which can contain identifiers or unexpected sensitive metadata.
 */
export function classifyGatewayFailure(status, type = '', message = '') {
  const kind = typeof type === 'string' ? type.toLowerCase() : '';
  const hint = typeof message === 'string' ? message.toLowerCase().slice(0, 350) : '';
  if (status === 403 && (kind.includes('customer_verification') ||
      hint.includes('customer verification') || hint.includes('payment method'))) {
    return { code: 'customer_verification_required', retry: false,
      error: 'Vercel requires account/payment-method verification before free AI Gateway credits can be used. Open Vercel Billing / AI Gateway Overview to verify your account. No payment or top-up has been initiated.' };
  }
  if (status === 403 && (kind === 'access_denied' ||
      kind.includes('permission') || hint.includes('forbidden'))) {
    return { code: 'access_denied', retry: false,
      error: 'Vercel AI Gateway denied access for this team (HTTP 403). Check team AI Gateway access, account verification and credits. Requests rejected before generation might not appear in AI Gateway Logs.' };
  }
  if (status === 403 && (kind.includes('model') ||
      hint.includes('not available on the free tier') ||
      hint.includes('model is not available'))) {
    return { code: 'model_access_denied', retry: true,
      error: 'This particular model is unavailable on your free tier.' };
  }
  if (status === 403) {
    return { code: 'gateway_forbidden', retry: false,
      error: 'Vercel AI Gateway returned HTTP 403 before a model could reply. Check account verification and model access in AI Gateway Overview; the request may not be recorded in Gateway Logs.' };
  }
  if (status === 401) return { code: 'invalid_gateway_key', retry: false,
    error: 'Vercel AI Gateway rejected the API key (HTTP 401). Verify the production AI_GATEWAY_API_KEY belongs to this team.' };
  if (status === 402) return { code: 'gateway_credits_required', retry: false,
    error: 'Vercel AI Gateway credits or the project budget are exhausted (HTTP 402). Check AI Gateway Overview; OpenDots will not purchase credits.' };
  if (status === 429) return { code: 'gateway_rate_limited', retry: true,
    error: 'Free AI Gateway models are rate limited (HTTP 429).' };
  return { code: 'provider_unavailable', retry: status >= 500 || status === 404 || status === 400,
    error: 'The selected AI provider could not serve this request.' };
}
async function readGatewayFailure(upstream) {
  let errorData = {};
  try {
    const raw = (await upstream.text()).slice(0, 2048);
    const parsed = JSON.parse(raw);
    errorData = (parsed && typeof parsed.error === 'object' && parsed.error) || {};
  } catch { /* An HTML or empty gateway error has no safe structured details. */ }
  const err = classifyGatewayFailure(
    upstream.status,
    typeof errorData.type === 'string' ? errorData.type :
      typeof errorData.code === 'string' ? errorData.code : '',
    typeof errorData.message === 'string' ? errorData.message : '',
  );
  // Only machine-readable classification; NEVER log API keys, prompts or raw responses.
  console.warn('[OpenDots Cloud Chat] Gateway rejected inference', {
    status: upstream.status, category: err.code,
  });
  return { ...err, gatewayStatus: upstream.status };
}

export default async function handler(request, response) {
  if (request.method === 'GET') {
    return send(response, 200, {
      service: 'OpenDots serverless chat',
      mode: 'free-model-only',
      hosting: 'Vercel',
      configured: Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY ||
        request.headers['x-vercel-oidc-token']),
    });
  }
  if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed.' });
  if (!sameOrigin(request)) return send(response, 403, { error: 'Cross-origin requests are disabled.' });
  if (Number(request.headers['content-length'] || 0) > 20000)
    return send(response, 413, { error: 'Chat input is too large.' });
  let body;
  try { body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
  catch { return send(response, 400, { error: 'Invalid JSON request.' }); }
  const messages = validMessages(body);
  if (!messages) return send(response, 400, { error: 'Send up to 18 valid chat messages (max 13,000 characters total).' });

  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN ||
    request.headers['x-vercel-oidc-token'];
  if (!token) return send(response, 503, { error: 'Vercel AI Gateway authentication is not available for this deployment.' });
  let candidates;
  try { candidates = await getFreeModels(); }
  catch { return send(response, 503, { error: 'Could not verify the current free AI model catalog. Try again.' }); }
  if (!candidates.length) return send(response, 503, {
    error: 'No zero-priced models are currently listed. Paid models have been disabled to protect your budget.'
  });


  const prompt = [
    { role: 'system', content: 'You are OpenDots, a helpful, thoughtful AI chat assistant. Answer in the user\\'s preferred language; understand Hinglish and Hindi. Never pretend to have run web browsing, computer tools, background jobs, or other unavailable actions. This is a lightweight browser-only chat session with no tool access.' },
    ...messages,
  ];
  let lastFailure;
  for (const model of candidates.slice(0, 5)) {
    try {
      const upstream = await fetch(gateway + '/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages: prompt, max_tokens: 600, stream: false }),
        signal: AbortSignal.timeout(9000),
      });
      if (!upstream.ok) {
        lastFailure = await readGatewayFailure(upstream);
        if (!lastFailure.retry) {
          return send(response, 503, {
            error: lastFailure.error, reason: lastFailure.code,
            gatewayStatus: lastFailure.gatewayStatus,
          });
        }
        continue;
      }
      const data = await upstream.json();
      const answer = data?.choices?.[0]?.message?.content;
      if (typeof answer === 'string' && answer.trim()) {
        return send(response, 200, { reply: answer.trim(), model });
      }
    } catch (error) {
      console.warn('[OpenDots Cloud Chat] Free model request unavailable', {
        category: error?.name === 'TimeoutError' ? 'timeout' : 'network_or_provider',
      });
    }
  }
  return send(response, 503, {
    error: lastFailure?.error || 'Free AI models could not respond. Check AI Gateway model access and credits.',
    reason: lastFailure?.code || 'no_available_free_model',
    gatewayStatus: lastFailure?.gatewayStatus,
  });
del-only',
      hosting: 'Vercel',
      configured: Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY ||
        request.headers['x-vercel-oidc-token']),
    });
  }
  if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed.' });
  if (!sameOrigin(request)) return send(response, 403, { error: 'Cross-origin requests are disabled.' });
  if (Number(request.headers['content-length'] || 0) > 20000)
    return send(response, 413, { error: 'Chat input is too large.' });
  let body;
  try { body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
  catch { return send(response, 400, { error: 'Invalid JSON request.' }); }
  const messages = validMessages(body);
  if (!messages) return send(response, 400, { error: 'Send up to 18 valid chat messages (max 13,000 characters total).' });

  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN ||
    request.headers['x-vercel-oidc-token'];
  if (!token) return send(response, 503, { error: 'Vercel AI Gateway authentication is not available for this deployment.' });
  let candidates;
  try { candidates = await getFreeModels(); }
  catch { return send(response, 503, { error: 'Could not verify the current free AI model catalog. Try again.' }); }
  if (!candidates.length) return send(response, 503, {
    error: 'No zero-priced models are currently listed. Paid models have been disabled to protect your budget.'
  });

  const prompt = [
    { role: 'system', content: 'You are OpenDots, a helpful, thoughtful AI chat assistant. Answer in the user\'s preferred language; understand Hinglish and Hindi. Never pretend to have run web browsing, computer tools, background jobs, or other unavailable actions. This is a lightweight browser-only chat session with no tool access.' },
    ...messages,
  ];
  let lastUpstreamStatus = 0;
  for (const model of candidates.slice(0, 5)) {
    try {
      const upstream = await fetch(gateway + '/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages: prompt, max_tokens: 600, stream: false }),
        signal: AbortSignal.timeout(9000),
      });
      if (!upstream.ok) {
        // Do not surface provider internals or raw upstream errors to the browser.
        lastUpstreamStatus = upstream.status;
        // 403 can be model-specific; try a *different verified free* model.
        // Only 401/402 signal authentication or credits and stop immediately.
        if ([401, 402].includes(upstream.status)) {
          return send(response, 503, {
            error: 'Vercel AI Gateway authentication or free access is unavailable.',
            gatewayStatus: upstream.status,
          });
        }
        continue;
      }
      const data = await upstream.json();
      const answer = data?.choices?.[0]?.message?.content;
      if (typeof answer === 'string' && answer.trim()) {
        return send(response, 200, { reply: answer.trim(), model });
      }
    } catch {
      // Retry another currently free model.
    }
  }
  return send(response, 503, {
    error: 'Free AI models could not respond right now (model access, capacity or quota). Try again later.',
    gatewayStatus: lastUpstreamStatus || undefined
  });
}
