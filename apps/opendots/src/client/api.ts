let token = sessionStorage.getItem('opendots-token') ?? '';
export function setToken(value: string) {
  token = value;
  if (value) sessionStorage.setItem('opendots-token', value);
  else sessionStorage.removeItem('opendots-token');
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    cache: 'no-store',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(['GET', 'HEAD'].includes(method)
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;

  // A Vite SPA fallback can erroneously serve index.html with HTTP 200 for
  // /api/* requests. Never interpret such a page as authenticated API success.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('json')) {
    const routeMarker = response.headers.get('x-opendots-route');
    const routeHint = routeMarker === 'external-funnel-v3'
      ? 'The upstream backend returned a non-JSON response.'
      : 'The Vercel /api route did not reach the configured Funnel rewrite.';
    throw new ApiError(
      `OpenDots API routing error at /api${path}: HTTP ${response.status}, ${contentType || 'unknown content type'}. ${routeHint} Check Vercel deployment and the Tailscale Funnel.`,
      response.status,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      `OpenDots API returned invalid JSON at /api${path} (HTTP ${response.status}). Check the backend and rewrite logs.`,
      response.status,
    );
  }
  if (!response.ok) {
    const error =
      data && typeof data === 'object' && 'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : `OpenDots API request failed: HTTP ${response.status} at /api${path}.`;
    throw new ApiError(error, response.status);
  }
  // Valid JSON `null` is an intentional success response for optional
  // resources such as conversation captures and page context. Parsing failures
  // are already rejected above; do not mistake a valid `null` for bad JSON.
  return data as T;
}
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
