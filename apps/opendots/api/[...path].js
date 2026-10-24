/**
 * Vercel Edge gateway for the OpenDots UI. API/stream requests continue to
 * run on the persistent Docker backend, NOT inside a stateless Vercel function.
 * The backend handles OWNER_TOKEN authorization and agent execution.
 */
export const config = { runtime: 'edge' };

export default async function handler(request) {
  const rawOrigin = process.env.OPENDOTS_BACKEND_ORIGIN;
  let origin;
  try {
    origin = new URL(rawOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) throw Error();
  } catch {
    return Response.json(
      { error: 'Backend is not configured. Set OPENDOTS_BACKEND_ORIGIN to your HTTPS backend origin.' },
      { status: 503 }
    );
  }

  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith('/api/')) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const target = new URL(incoming.pathname + incoming.search, origin);
  const headers = new Headers(request.headers);
  // Browser Fetch Metadata is only meaningful on its original hop.
  // Forwarding it into a new Vercel Edge -> Tailscale cross-site hop causes
  // the backend's CSRF middleware to reject legitimate authenticated traffic.
  // Preserve Authorization and Origin; these remain enforced on the backend.
  for (const name of ['host','connection','content-length','transfer-encoding',
    'x-forwarded-for','x-forwarded-host','x-forwarded-proto','cf-connecting-ip',
    'sec-fetch-site','sec-fetch-mode','sec-fetch-dest','sec-fetch-user']) {
    headers.delete(name);
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET','HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    });
  } catch {
    return Response.json({ error: 'Persistent OpenDots backend is unavailable.' }, { status: 502 });
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of ['connection','transfer-encoding','content-encoding','content-length']) {
    responseHeaders.delete(name);
  }
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
