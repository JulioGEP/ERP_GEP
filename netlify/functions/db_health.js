const crypto = require('crypto');
const { successResponse, errorResponse, COMMON_HEADERS } = require('./_shared/response');
const { prisma } = require('./_shared/prisma');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  const requestId = crypto.randomUUID();
  const start = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const duration = Date.now() - start;

    return successResponse({
      requestId,
      latency_ms: duration
    });
  } catch (error) {
    console.error(`[${requestId}] db_health error`, error);
    const message = error instanceof Error ? error.message : 'Error inesperado';

    return errorResponse({
      statusCode: 500,
      errorCode: 'DB_HEALTH_FAIL',
      message,
      requestId
    });
  }
};
