import { randomUUID } from 'crypto';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { logAudit, resolveUserIdFromEvent, type JsonValue } from './_shared/audit-log';
import { getPrisma } from './_shared/prisma';

function toJsonValue(input: unknown): JsonValue | null {
  if (input === undefined || input === null) {
    return null;
  }
  if (typeof input === 'object') {
    return input as JsonValue;
  }
  return JSON.parse(JSON.stringify(input)) as JsonValue;
}

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const actionRaw = typeof request.body?.action === 'string' ? request.body.action.trim() : '';
  if (!actionRaw.length) {
    return errorResponse('INVALID_INPUT', 'El campo action es obligatorio.', 400);
  }

  const entityTypeRaw =
    typeof request.body?.entityType === 'string' ? request.body.entityType.trim() : '';
  const entityIdRaw = typeof request.body?.entityId === 'string' ? request.body.entityId.trim() : '';

  const entityType = entityTypeRaw.length ? entityTypeRaw : 'client_event';
  const entityId = entityIdRaw.length ? entityIdRaw : randomUUID();
  const details = toJsonValue(request.body?.details ?? request.body?.metadata ?? null);

  try {
    const prisma = getPrisma();
    const userId = await resolveUserIdFromEvent(request.event, prisma);

    await logAudit({
      userId,
      action: actionRaw,
      entityType,
      entityId,
      before: null,
      after: details,
      prisma,
    });

    return successResponse({ ok: true });
  } catch (error) {
    console.error('[audit-events] Failed to persist audit event', error);
    return errorResponse('AUDIT_ERROR', 'No se pudo registrar el evento de auditoría.', 500);
  }
});
