const COMMON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: JSON.stringify(body)
  };
}

function successResponse(body = {}, statusCode = 200) {
  return jsonResponse(statusCode, { ok: true, ...body });
}

function errorResponse({
  statusCode = 500,
  errorCode = 'UNEXPECTED_ERROR',
  message = 'Error inesperado',
  requestId,
  details
}) {
  const payload = {
    ok: false,
    error_code: errorCode,
    message
  };

  if (requestId) {
    payload.requestId = requestId;
  }

  if (details !== undefined) {
    payload.details = details;
  }

  return jsonResponse(statusCode, payload);
}

module.exports = {
  COMMON_HEADERS,
  jsonResponse,
  successResponse,
  errorResponse
};
