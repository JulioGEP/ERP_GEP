// netlify/functions/_shared/response.js
const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json; charset=utf-8',
};

function successResponse(payload = {}, statusCode = 200) {
  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: JSON.stringify(payload),
  };
}

function errorResponse(error_code = 'UNEXPECTED_ERROR', message = 'Error inesperado', statusCode = 500) {
  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: JSON.stringify({ ok: false, error_code, message }),
  };
}

module.exports = { COMMON_HEADERS, successResponse, errorResponse };
