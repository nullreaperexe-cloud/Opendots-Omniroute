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
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(['GET', 'HEAD'].includes(method)
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!response.ok)
    throw new ApiError(
      data?.error ||
        `Request failed (HTTP ${response.status}). The API proxy returned a non-JSON response; check Vercel/Tailscale and the backend logs.`,
      response.status,
    );
  if (response.status === 204) return undefined as T;
  if (data === null)
    throw new ApiError(
      `Server returned an unreadable HTTP ${response.status} response. Check the backend logs and proxy.`,
      response.status,
    );
  return data as T;
}
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
