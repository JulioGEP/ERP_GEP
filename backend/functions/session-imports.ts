// backend/functions/session-imports.ts
import { preflightResponse, successResponse, errorResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';

type SessionImportRow = {
  dealId: string;
  sessionNumber: string;
  start: string;
  end: string;
  trainer: string;
  trainerSup: string;
  estado: string;
};

type SessionImportRequest = {
  dealId: string;
  rows: SessionImportRow[];
};

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length ? trimmed : '';
}

export const handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();

  try {
    await requireAuth(event, { roles: ['Admin', 'Logistica', 'Administracion', 'People'] });

    if (event.httpMethod !== 'POST') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Solo se permite POST', 405);
    }

    let payload: SessionImportRequest | null = null;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return errorResponse('INVALID_BODY', 'El formato del cuerpo no es válido', 400);
    }

    const dealId = normalizeText(payload?.dealId);
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];

    if (!dealId) return errorResponse('VALIDATION_ERROR', 'dealId es obligatorio', 400);
    if (!rows.length) return errorResponse('VALIDATION_ERROR', 'No hay sesiones para importar', 400);

    const sanitizedRows = rows
      .map((row) => ({
        dealId,
        sessionNumber: normalizeText((row as any)?.sessionNumber),
        start: normalizeText((row as any)?.start),
        end: normalizeText((row as any)?.end),
        trainer: normalizeText((row as any)?.trainer),
        trainerSup: normalizeText((row as any)?.trainerSup),
        estado: normalizeText((row as any)?.estado),
      }))
      .filter((row) => row.sessionNumber && row.start && row.end);

    if (!sanitizedRows.length) {
      return errorResponse('VALIDATION_ERROR', 'No se encontraron sesiones válidas en la solicitud', 400);
    }

    // Nota: la persistencia real se debe implementar usando las reglas de negocio del ERP.
    // Por ahora devolvemos un resumen estático para permitir probar el flujo de importación desde el frontend.
    const created = sanitizedRows.length;
    const updated = 0;
    const removed = 0;

    return successResponse({
      dealId,
      created,
      updated,
      removed,
      message: 'Sesiones recibidas correctamente (pendiente de persistencia real).',
    });
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in (err as any)) return err as any;
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
};

export default handler;
