export type RequestUser = {
  id: string | null;
  name: string | null;
  displayName: string | null;
};

function normalize(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function getHeader(headers: Record<string, unknown>, key: string): string | null {
  const direct = headers[key];
  if (typeof direct === 'string') return direct;
  const lower = headers[key.toLowerCase()];
  return typeof lower === 'string' ? lower : null;
}

export function extractRequestUser(source: { headers?: unknown } | null | undefined): RequestUser {
  const rawHeaders = (source && typeof source === 'object' && 'headers' in source
    ? (source as any).headers
    : source) as Record<string, unknown> | undefined;
  const headers: Record<string, unknown> = rawHeaders && typeof rawHeaders === 'object' ? rawHeaders : {};

  const userId = normalize(getHeader(headers, 'X-User-Id'));
  const userName = normalize(getHeader(headers, 'X-User-Name'));
  const displayName = userName ?? userId ?? null;

  return { id: userId, name: userName, displayName };
}
