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
    { role: 'system', content: 'You are OpenDots, a helpful, thoughtful AI chat assistant. Answer in the user\'s preferred language; understand Hinglish and Hindi. Never pretend to have run web browsing, computer tools, background jobs, or other unavailable actions. This is a lightweight browser-only chat session with no tool access.' },
    ...messages,
  ];
  for (const model of candidates.slice(0, 3)) {
    try {
      const upstream = await fetch(gateway + '/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages: prompt, max_tokens: 600, stream: false }),
        signal: AbortSignal.timeout(35000),
      });
      if (!upstream.ok) {
        // Do not surface provider internals or raw upstream errors to the browser.
        if ([401, 402, 403].includes(upstream.status)) {
          return send(response, 503, { error: 'Vercel AI Gateway is not authorized or has no free access enabled for this project.' });
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
    error: 'Free AI models could not respond right now (capacity or quota). Try again later.'
  });
}
