import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import {
  TrainerCalendarError,
  completeTrainerCalendarOAuth,
  disconnectTrainerCalendar,
  getTrainerCalendarStatus,
  getTrainerIdForUser,
  isCalendarFeatureConfigured,
  startTrainerCalendarOAuth,
  syncTrainerCalendar,
} from './_shared/trainerCalendar';

function isStatusPath(path: string): boolean {
  return /\/trainer-calendar\/status(?:\/)?$/i.test(path);
}

function isStartPath(path: string): boolean {
  return /\/trainer-calendar\/oauth\/start(?:\/)?$/i.test(path);
}

function isDisconnectPath(path: string): boolean {
  return /\/trainer-calendar\/disconnect(?:\/)?$/i.test(path);
}

function isSyncPath(path: string): boolean {
  return /\/trainer-calendar\/sync(?:\/)?$/i.test(path);
}

function isCallbackPath(path: string): boolean {
  return /\/trainer-calendar\/oauth\/callback(?:\/)?$/i.test(path);
}

function buildRedirectUrl(basePath: string | null | undefined, params: Record<string, string>): string {
  const base = basePath && basePath.trim().length ? basePath.trim() : '/perfil';
  try {
    const url = new URL(base, 'https://erp.placeholder.local');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const search = url.search ? url.search : '';
    const hash = url.hash ? url.hash : '';
    return `${url.pathname}${search}${hash}`;
  } catch {
    const query = new URLSearchParams(params).toString();
    return `${base}${base.includes('?') ? '&' : '?'}${query}`;
  }
}

function mapTrainerCalendarError(err: unknown) {
  if (err instanceof TrainerCalendarError) {
    const status = err.code === 'CALENDAR_NOT_CONFIGURED' ? 503 : err.code === 'TRAINER_NOT_FOUND' ? 404 : 400;
    return errorResponse(err.code, err.message, status);
  }
  console.error('[trainer-calendar] error inesperado', err);
  return errorResponse('CALENDAR_INTERNAL', 'No se pudo completar la operación con Google Calendar.', 500);
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const path = request.path || '';
  const method = (request.method || 'GET').toUpperCase();

  if (isCallbackPath(path) && method === 'GET') {
    const state = request.query.state ?? '';
    const code = request.query.code ?? '';
    const errorParam = request.query.error ?? '';

    if (!state) {
      const redirect = buildRedirectUrl(request.query.returnTo ?? '/perfil', {
        calendar: 'error',
        calendarError: 'missing_state',
      });
      return { statusCode: 302, headers: { Location: redirect, 'Cache-Control': 'no-store' }, body: '' };
    }

    if (errorParam) {
      const redirect = buildRedirectUrl(request.query.returnTo ?? '/perfil', {
        calendar: 'error',
        calendarError: String(errorParam),
      });
      return { statusCode: 302, headers: { Location: redirect, 'Cache-Control': 'no-store' }, body: '' };
    }

    if (!code) {
      const redirect = buildRedirectUrl(request.query.returnTo ?? '/perfil', {
        calendar: 'error',
        calendarError: 'missing_code',
      });
      return { statusCode: 302, headers: { Location: redirect, 'Cache-Control': 'no-store' }, body: '' };
    }

    const result = await completeTrainerCalendarOAuth(prisma, String(state), String(code));
    const redirect = buildRedirectUrl(result.redirectTo, {
      calendar: result.success ? 'connected' : 'error',
      ...(result.success ? {} : { calendarError: result.error ?? 'unknown' }),
    });
    return { statusCode: 302, headers: { Location: redirect, 'Cache-Control': 'no-store' }, body: '' };
  }

  const auth = await requireAuth(request, prisma, { requireRoles: ['Formador'] });
  if ('error' in auth) {
    return auth.error;
  }

  const trainerId = await getTrainerIdForUser(prisma, auth.user.id);
  if (!trainerId) {
    return errorResponse('TRAINER_NOT_FOUND', 'No se encontró formador asociado al usuario.', 404);
  }

  try {
    if (isStatusPath(path) && method === 'GET') {
      const statusPayload = await getTrainerCalendarStatus(prisma, trainerId);
      return successResponse(statusPayload);
    }

    if (isStartPath(path) && method === 'POST') {
      const body = (request.body as any) ?? {};
      const returnTo = typeof body.returnTo === 'string' ? body.returnTo : undefined;
      const url = await startTrainerCalendarOAuth(prisma, trainerId, { returnTo });
      return successResponse({ url });
    }

    if (isDisconnectPath(path) && method === 'POST') {
      await disconnectTrainerCalendar(prisma, trainerId);
      return successResponse({ ok: true });
    }

    if (isSyncPath(path) && method === 'POST') {
      if (!isCalendarFeatureConfigured()) {
        throw new TrainerCalendarError('CALENDAR_NOT_CONFIGURED', 'La integración de Google Calendar no está configurada.');
      }
      await syncTrainerCalendar(prisma, trainerId);
      return successResponse({ ok: true });
    }
  } catch (error) {
    return mapTrainerCalendarError(error);
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Ruta o método no soportado.', 405);
});
