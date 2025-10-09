// backend/functions/deal-sessions.ts
import { COMMON_HEADERS, errorResponse, preflightResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { toMadridISOString } from './_shared/timezone';
import { randomUUID } from 'crypto';

const VALID_STATUS = new Set(['BORRADOR', 'PLANIFICADA', 'SUSPENDIDO', 'CANCELADO']);

function parseSessionId(path?: string | null): string | null {
  if (!path) return null;
  const match = path.match(/deal-sessions\/?([^/?#]+)/i);
  if (!match || match.length < 2) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function toNullableString(value: any): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function parseDate(value: any): Date | null {
  const str = toNullableString(value);
  if (!str) return null;
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseIdArray(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => toNullableString(entry))
      .filter((entry): entry is string => !!entry);
  }

  const str = toNullableString(value);
  if (!str) return [];

  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => toNullableString(entry))
        .filter((entry): entry is string => !!entry);
    }
  } catch {
    // ignore JSON parse errors, fallback to comma separated string
  }

  return str
    .split(',')
    .map((entry) => toNullableString(entry))
    .filter((entry): entry is string => !!entry);
}

function encodeIdArray(values: string[]): string | null {
  const unique = Array.from(new Set(values.map((entry) => entry.trim()).filter((entry) => entry.length)));
  return unique.length ? JSON.stringify(unique) : null;
}

function normalizeStatus(value: any): string {
  const str = toNullableString(value)?.toUpperCase() ?? null;
  if (!str) return 'BORRADOR';
  return VALID_STATUS.has(str) ? str : 'BORRADOR';
}

function mapSessionForApi(row: any) {
  if (!row) return row;
  return {
    seasson_id: row.seasson_id,
    deal_id: row.deal_id,
    status: normalizeStatus(row.status),
    date_start: toMadridISOString(row.date_start),
    date_end: toMadridISOString(row.date_end),
    sede: row.sede ?? null,
    seasson_address: row.seasson_address ?? null,
    room_id: row.room_id ?? null,
    seasson_fireman: parseIdArray(row.seasson_fireman),
    seasson_vehicle: parseIdArray(row.seasson_vehicle),
    comment_seasson: row.comment_seasson ?? null,
  };
}

function buildSessionData(body: any) {
  const source = body && typeof body === 'object' && body.session && typeof body.session === 'object'
    ? body.session
    : body;

  const statusRaw = normalizeStatus(source?.status ?? source?.state);
  const start = parseDate(source?.date_start ?? source?.dateStart ?? source?.start);
  const end = parseDate(source?.date_end ?? source?.dateEnd ?? source?.end);
  const sede = toNullableString(source?.sede ?? source?.location_sede ?? source?.sede_label);
  const address = toNullableString(source?.seasson_address ?? source?.address ?? source?.training_address);
  const roomId = toNullableString(source?.room_id ?? source?.roomId ?? source?.sala_id ?? source?.room);
  const trainers = parseIdArray(source?.seasson_fireman ?? source?.trainers ?? source?.trainerIds ?? source?.trainer_ids);
  const mobileUnits = parseIdArray(source?.seasson_vehicle ?? source?.mobile_units ?? source?.mobileUnitIds ?? source?.mobile_unit_ids);
  const comment = toNullableString(source?.comment_seasson ?? source?.comment ?? source?.comments);

  return {
    status: statusRaw,
    start,
    end,
    sede,
    address,
    roomId,
    trainers,
    mobileUnits,
    comment,
  };
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const method = event.httpMethod ?? 'GET';
    const prisma = getPrisma();
    const sessionId = parseSessionId(event.path);
    const dealIdParam =
      event.queryStringParameters?.dealId ??
      event.queryStringParameters?.deal_id ??
      (event.pathParameters ? event.pathParameters.dealId : null);

    if (method === 'GET') {
      const dealId = toNullableString(dealIdParam);
      if (!dealId) {
        return errorResponse('VALIDATION_ERROR', 'dealId requerido', 400);
      }

      const sessions = await prisma.seassons.findMany({
        where: { deal_id: dealId },
        orderBy: [{ date_start: 'asc' }, { seasson_id: 'asc' }],
      });

      return successResponse({ sessions: sessions.map(mapSessionForApi) });
    }

    if (method === 'POST') {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      let body: any;
      try {
        body = JSON.parse(event.body);
      } catch {
        return errorResponse('INVALID_JSON', 'JSON inválido', 400);
      }
      const dealId = toNullableString(body?.dealId ?? body?.deal_id ?? dealIdParam);
      if (!dealId) {
        return errorResponse('VALIDATION_ERROR', 'dealId requerido', 400);
      }

      const deal = await prisma.deals.findUnique({ where: { deal_id: dealId }, select: { deal_id: true } });
      if (!deal) {
        return errorResponse('NOT_FOUND', 'Deal no encontrado', 404);
      }

      const data = buildSessionData(body);
      const sessionData: any = {
        seasson_id: randomUUID(),
        deal_id: dealId,
        status: data.status,
        date_start: data.start,
        date_end: data.end,
        sede: data.sede,
        seasson_address: data.address,
        room_id: data.roomId,
        seasson_fireman: encodeIdArray(data.trainers),
        seasson_vehicle: encodeIdArray(data.mobileUnits),
        comment_seasson: data.comment,
      };

      const created = await prisma.seassons.create({ data: sessionData });
      return successResponse({ session: mapSessionForApi(created) }, 201);
    }

    if (method === 'PATCH' && sessionId) {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const existing = await prisma.seassons.findUnique({
        where: { seasson_id: sessionId },
      });

      if (!existing) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
      }

      let body: any;
      try {
        body = JSON.parse(event.body);
      } catch {
        return errorResponse('INVALID_JSON', 'JSON inválido', 400);
      }
      const data = buildSessionData(body);

      const updateData: any = {
        status: data.status,
        date_start: data.start,
        date_end: data.end,
        sede: data.sede,
        seasson_address: data.address,
        room_id: data.roomId,
        seasson_fireman: encodeIdArray(data.trainers),
        seasson_vehicle: encodeIdArray(data.mobileUnits),
        comment_seasson: data.comment,
      };

      const updated = await prisma.seassons.update({
        where: { seasson_id: sessionId },
        data: updateData,
      });

      return successResponse({ session: mapSessionForApi(updated) });
    }

    if (method === 'DELETE' && sessionId) {
      const existing = await prisma.seassons.findUnique({
        where: { seasson_id: sessionId },
        select: { seasson_id: true },
      });

      if (!existing) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
      }

      await prisma.seassons.delete({ where: { seasson_id: sessionId } });
      return successResponse({ ok: true });
    }

    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: false, error_code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido' }),
    };
  } catch (error: any) {
    const message = error?.message || 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
};
