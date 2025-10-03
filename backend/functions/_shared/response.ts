export const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-User-Name'
};

export function successResponse(body: any, statusCode = 200) {
  return { statusCode, headers: COMMON_HEADERS, body: JSON.stringify(body) };
}

export function errorResponse(code: string, message: string, statusCode = 400) {
  return { statusCode, headers: COMMON_HEADERS, body: JSON.stringify({ ok: false, code, message }) };
}
