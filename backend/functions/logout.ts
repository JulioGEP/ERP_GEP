import { createHttpHandler } from './_shared/http';
import { extractAuthToken, revokeUserSession } from './_shared/auth';
import { errorResponse, successResponse } from './_shared/response';

export default createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
  }

  const token = extractAuthToken(request.headers);
  if (!token) {
    return successResponse({ data: { logged_out: true } });
  }

  await revokeUserSession(token);
  return successResponse({ data: { logged_out: true } });
});
