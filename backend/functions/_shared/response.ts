// backend/functions/_shared/response.ts

export const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-User-Name'
};

// Serializador seguro: convierte BigInt a string para que JSON.stringify no falle
function safeStringify(payload: unknown): string {
  return JSON.stringify(
    payload,
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
  );
}

export function successResponse(body: any, statusCode = 200) {
  return { statusCode, headers: COMMON_HEADERS, body: safeStringify({ ok: true, ...body }) };
}

export function errorResponse(code: string, message: string, statusCode = 400) {
  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: safeStringify({ ok: false, code, message })
  };
}
