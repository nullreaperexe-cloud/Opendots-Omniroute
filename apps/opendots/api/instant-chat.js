/**
 * OpenDots' Docker-free cloud chat backend.
 * Runs as a Vercel Serverless Function, connecting DIRECTLY to GroqCloud.
 * Credentials exist only in Vercel's encrypted production environment.
 *
 * Chat only: the full autonomous agent, home browser and legacy memory are
 * separate from this serverless fallback, and require their own backend.
 */
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const ALLOWED_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
];
function send(response, status, payload) {
  response.status(status)
    .setHeader('Cache-Control', 'no-store, private')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .json(payload);
}
function sameOrigin(request) {
  const origin = request.headers?.origin;
  if (request.headers?.['sec-fetch-site'] === 'cross-site') return false;
  if (!origin) return true;
  try {
    const expected = new URL('https://' + request.headers.host);
    return new URL(origin).origin === expected.origin;
  } catch { return false; }
}
function validMessages(body) {
  if (!body || !Array.isArray(body.messages) ||
      body.messages.length < 1 || body.messages.length > 18) return null;
  let size = 0;
  const result = [];
  for (const message of body.messages) {
    if (!message || !['user','assistant'].includes(message.role) ||
        typeof message.content !== 'string' || !message.content.trim() ||
        message.content.length > 2400) return null;
    size += message.content.length;
    if (size > 13000) return null;
    result.push({ role: message.role, content: message.content });
  }
  return result.at(-1)?.role === 'user' ? result : null;
}
function modelOrder() {
  // Never route to an arbitrary unknown model based on untrusted client input.
  const configured = process.env.GROQ_MODEL;
  if (configured && ALLOWED_MODELS.includes(configured)) {
    return [configured, ...ALLOWED_MODELS.filter(m => m !== configured)];
  }
  return ALLOWED_MODELS;
}
export function classifyGroqFailure(status, errorCode = '') {
  const code = String(errorCode).toLowerCase();
  if (status === 401 || code === 'invalid_api_key') return {
    reason: 'groq_invalid_key', retry: false,
    error: 'Groq rejected the API key. Check GROQ_API_KEY in Vercel Production Environment Variables.',
  };
  if (status === 403) return {
    reason: 'groq_access_denied', retry: false,
    error: 'Groq denied access to this project or model (HTTP 403). Check your GroqCloud project and API key permissions.',
  };
  if (status === 429) return {
    reason: 'groq_rate_limited', retry: true,
    error: 'Groq free-tier limit reached. Your available requests or tokens will reset according to your GroqCloud Limits page.',
  };
  if (status === 400 && (code.includes('model') || code === 'model_decommissioned')) return {
    reason: 'groq_model_unavailable', retry: true,
    error: 'The selected Groq model is unavailable. Switching to another supported model.',
  };
  if (status === 404) return {
    reason: 'groq_model_unavailable', retry: true,
    error: 'Groq model is not currently available. Switching to another supported model.',
  };
  if (status >= 500) return {
    reason: 'groq_temporarily_unavailable', retry: true,
    error: 'Groq inference is temporarily unavailable. Try again shortly.',
  };
  return {
    reason: 'groq_request_rejected', retry: false,
    error: 'Groq rejected this inference request. Check your account model access and settings.',
  };
}
async function classifyResponse(response) {
  let errorCode = '';
  try {
    const data = JSON.parse((await response.text()).slice(0, 1600));
    errorCode = typeof data?.error?.code === 'string' ? data.error.code :
      typeof data?.error?.type === 'string' ? data.error.type : '';
  } catch { /* Ignore non-JSON upstream diagnostics. */ }
  const result = classifyGroqFailure(response.status, errorCode);
  // Never log API keys, prompts or raw upstream provider responses.
  console.warn('[OpenDots Cloud Chat] Groq upstream status', {
    status: response.status, reason: result.reason,
  });
  return { ...result, upstreamStatus: response.status };
}

export default async function handler(request, response) {
  if (request.method === 'GET') return send(response, 200, {
    service: 'OpenDots cloud chat',
    provider: 'groq',
    mode: 'serverless-chat',
    configured: Boolean(process.env.GROQ_API_KEY?.trim()),
    cloudBrowser: false,
  });
  if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed.' });
  if (!sameOrigin(request)) return send(response, 403, { error: 'Cross-origin requests are disabled.' });
  if (Number(request.headers?.['content-length'] || 0) > 20000)
    return send(response, 413, { error: 'Chat input is too large.' });
  let body;
  try { body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
  catch { return send(response, 400, { error: 'Invalid JSON request.' }); }
  const messages = validMessages(body);
  if (!messages) return send(response, 400, {
    error: 'Send up to 18 valid chat messages (max 13,000 characters total).',
  });
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return send(response, 503, {
    error: 'GroqCloud API key is not connected yet. Add GROQ_API_KEY in Vercel Project → Settings → Environment Variables (Production), then redeploy.',
    reason: 'groq_key_missing',
  });
  const prompt = [
    { role: 'system', content: "You are OpenDots, a helpful AI chat assistant. Reply in the user's preferred language, including natural Hindi and Hinglish. You do not currently have browsing, computer automation, scheduled tasks, or any external tools; do not claim to have performed actions you cannot perform." },
    ...messages,
  ];
  let lastError;
  for (const model of modelOrder()) {
    try {
      const upstream = await fetch(GROQ_BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model, messages: prompt,
          max_completion_tokens: 800,
          stream: false,
        }),
        signal: AbortSignal.timeout(18000),
      });
      if (!upstream.ok) {
        lastError = await classifyResponse(upstream);
        if (!lastError.retry) return send(response, 503, {
          error: lastError.error, reason: lastError.reason, upstreamStatus: lastError.upstreamStatus,
        });
        continue;
      }
      const data = await upstream.json();
      const answer = data?.choices?.[0]?.message?.content;
      if (typeof answer === 'string' && answer.trim()) {
        return send(response, 200, { reply: answer.trim(), model, provider: 'groq' });
      }
      lastError = {
        error: 'Groq returned an empty response. Try a shorter question.',
        reason: 'groq_empty_response',
      };
    } catch (error) {
      console.warn('[OpenDots Cloud Chat] Groq request failed', {
        kind: error?.name === 'TimeoutError' ? 'timeout' : 'network_or_provider',
      });
      lastError = {
        error: 'Could not reach GroqCloud or the request timed out. Try again.',
        reason: 'groq_temporarily_unavailable',
      };
    }
  }
  return send(response, 503, {
    error: lastError?.error || 'GroqCloud did not return an AI reply.',
    reason: lastError?.reason || 'groq_unavailable',
    upstreamStatus: lastError?.upstreamStatus,
  });
}
