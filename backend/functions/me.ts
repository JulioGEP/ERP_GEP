import { createHttpHandler } from './_shared/http';
import { attachCurrentUser, serializeUser } from './_shared/auth';
import { ROLE_PERMISSIONS } from './_shared/permissions';
import { errorResponse, successResponse } from './_shared/response';

export default createHttpHandler(async (request) => {
  const authed = await attachCurrentUser(request);
  if ('error' in authed) {
    return authed.error;
  }

  try {
    return successResponse({
      data: {
        user: serializeUser(authed.request.currentUser),
        permissions: ROLE_PERMISSIONS,
      },
    });
  } catch (error) {
    console.error('[me] Error serializando usuario actual', error);
    return errorResponse('UNEXPECTED_ERROR', 'No se pudo cargar el usuario actual.', 500);
  }
});
