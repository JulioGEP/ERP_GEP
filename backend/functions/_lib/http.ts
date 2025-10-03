// backend/functions/_lib/http.ts

function safeStringify(payload: unknown): string {
  return JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export const json = (body: any, status = 200) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: safeStringify(body),
});

export const ok = (body: any = { ok: true }) => json(body, 200);

export const err = (code: string, message: string, status = 500) =>
  json({ ok: false, error_code: code, message, requestId: (globalThis.crypto as any).randomUUID?.() ?? '' }, status);

export function getUser(event: any) {
  const userId = event.headers?.['x-user-id'] || event.headers?.['X-User-Id'];
  const userName = event.headers?.['x-user-name'] || event.headers?.['X-User-Name'];
  return { userId, userName };
}
