/**
 * Single-segment Vercel Edge API gateway for the persistent OpenDots backend.
 *
 * Vite's /api functions must not depend on a Next.js-style [...path] route.
 * vercel.json rewrites /api/:path* to /api/proxy with the original path in
 * __opendots_path. Never put the owner token or OmniRoute key in this function.
 */
export const config = { runtime: 'edge' };

const ROUTE_PARAMETER = '__opendots_path';

function jsonError(message, status) {
  return Response.json({ error: message }, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-OpenDots-Proxy': 'vercel-edge-v2',
    },
  });
}

function safeApiPath(url) {
  const paths = url.searchParams.getAll(ROUTE_PARAMETER);
  if (paths.length !== 1 || !paths[0] || paths[0].length > 2048) return null;
  const segments = paths[0].split('/');
  const encoded = [];
  for (const segment of segments) {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      !decoded || decoded === '.' || decoded === '..' ||
      /[\\/\u0000-\u001f\u007f]/.test(decoded)
    ) return null;
    encoded.push(encodeURIComponent(decoded));
  }
  return encoded.join('/');
}

export default async function handler(request) {
  let origin;
  try {
    origin = new URL(process.env.OPENDOTS_BACKEND_ORIGIN);
    if (origin.protocol !== 'https:' || origin.username || origin.password ||
        origin.pathname !== '/' || origin.search || origin.hash) throw Error();
  } catch {
    return jsonError('Persistent backend origin is not configured.', 503);
  }

  const incoming = new URL(request.url);
  const apiPath = safeApiPath(incoming);
  if (!apiPath) {
    return jsonError('Invalid API proxy route.', 400);
  }
  const target = new URL('/api/' + apiPath, origin);
  const query = new URLSearchParams(incoming.searchParams);
  query.delete(ROUTE_PARAMETER);
  target.search = query.toString();

  // Authorization and Origin are end-to-end headers and must survive the proxy.
  // Hop-specific browser metadata must NOT cross the Vercel -> Funnel hop.
  const headers = new Headers(request.headers);
  for (const name of [
    'host', 'connection', 'content-length', 'transfer-encoding',
    'te', 'accept-encoding', 'cookie',
    'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
    'cf-connecting-ip',
    'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
  ]) headers.delete(name);

  let upstream;
  try {
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      ...(hasBody && request.body ? { duplex: 'half' } : {}),
      signal: request.signal,
      redirect: 'manual',
    });
  } catch {
    return jsonError('Persistent OpenDots backend is unavailable.', 502);
  }

  // fetch may transparently decompress the upstream response.
  const responseHeaders = new Headers(upstream.headers);
  for (const name of [
    'connection', 'transfer-encoding', 'content-encoding',
    'content-length', 'keep-alive',
  ]) responseHeaders.delete(name);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('X-OpenDots-Proxy', 'vercel-edge-v2');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
