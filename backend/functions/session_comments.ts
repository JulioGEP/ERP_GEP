// backend/functions/session_comments.ts
import { validate as isUUID } from 'uuid';
import { getPrisma } from './_shared/prisma';
import { ensureCors, errorResponse, preflightResponse, successResponse } from './_shared/response';
import { nowInMadridDate, toMadridISOString } from './_shared/timezone';

const DEFAULT_AUTHOR = process.env.DEFAULT_NOTE_AUTHOR || 'erp_user';

function parseCompartirFormador(value: any): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null;
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized.length) return null;
    if (['true', '1', 'si', 'sí', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return null;
}

function parsePath(path: string) {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?session_comments\/([^/]+)(?:\/([^/]+))?$/i);
  const sessionId = match?.[1] ? decodeURIComponent(match[1]) : null;
  const commentId = match?.[2] ? decodeURIComponent(match[2]) : null;
  return { sessionId, commentId };
}

function headerValue(event: any, key: string): string | null {
  const headers = event?.headers || {};
  const direct = headers[key];
  if (typeof direct === 'string') return direct;
  const lower = headers[key.toLowerCase()];
  return typeof lower === 'string' ? lower : null;
}

function mapCommentForResponse(comment: any) {
  if (!comment) return comment;
  return {
    id: typeof comment.id === 'bigint' ? comment.id.toString() : comment.id,
    deal_id: comment.deal_id,
    sesion_id: comment.sesion_id,
    content: comment.content,
    author: comment.author ?? DEFAULT_AUTHOR,
    compartir_formador: Boolean(comment.compartir_formador),
    created_at: toMadridISOString(comment.created_at),
    updated_at: toMadridISOString(comment.updated_at),
  };
}

function parseCommentId(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch (error) {
    return null;
  }
}

export const handler = async (event: any) => {
  const corsCheck = ensureCors(event);
  if (typeof corsCheck !== 'string') {
    return corsCheck;
  }

  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse(corsCheck);
    }

    const { sessionId, commentId } = parsePath(event.path || '');
    if (!sessionId) {
      return errorResponse('VALIDATION_ERROR', 'sesion_id requerido en path', 400);
    }

    const prisma = getPrisma();
    const sessionIdStr = String(sessionId).trim();
    if (!sessionIdStr || !isUUID(sessionIdStr)) {
      return errorResponse('VALIDATION_ERROR', 'sesion_id inválido (UUID requerido)', 400);
    }

    const method = event.httpMethod;
    const requestUser =
      headerValue(event, 'X-User-Name')?.trim() || headerValue(event, 'X-User-Id')?.trim() || null;

    if (method === 'GET' && !commentId) {
      const session = await prisma.sesiones.findUnique({
        where: { id: sessionIdStr },
        select: { id: true },
      });
      if (!session) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
      }

      const comments = await prisma.sesiones_comentarios.findMany({
        where: { sesion_id: sessionIdStr },
        orderBy: { created_at: 'desc' },
      });

      return successResponse({ comments: comments.map(mapCommentForResponse) });
    }

    if (method === 'POST' && !commentId) {
      if (!event.body) return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);

      const session = await prisma.sesiones.findUnique({
        where: { id: sessionIdStr },
        select: { id: true, deal_id: true },
      });
      if (!session) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
      }

      const { content, compartir_formador } = JSON.parse(event.body || '{}');
      const trimmedContent = typeof content === 'string' ? content.trim() : '';
      if (!trimmedContent.length) {
        return errorResponse('VALIDATION_ERROR', 'content requerido', 400);
      }

      const compartirFormadorValue = parseCompartirFormador(compartir_formador);

      const author = requestUser && requestUser.length ? requestUser : DEFAULT_AUTHOR;
      const now = nowInMadridDate();
      const dealId = typeof session.deal_id === 'string' ? session.deal_id.trim() : '';
      const sessionUuid = typeof session.id === 'string' ? session.id.trim() : '';
      if (!dealId.length || !sessionUuid.length) {
        return errorResponse(
          'VALIDATION_ERROR',
          'Sesión sin información de deal o identificador inválido',
          400,
        );
      }

      const created = await prisma.sesiones_comentarios.create({
        data: {
          deal_id: dealId,
          sesion_id: sessionUuid,
          content: trimmedContent,
          author,
          compartir_formador: compartirFormadorValue ?? false,
          created_at: now,
          updated_at: now,
        },
      });

      return successResponse({ comment: mapCommentForResponse(created) }, 201);
    }

    if (method === 'PATCH' && commentId) {
      if (!event.body) return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);

      const parsedCommentId = parseCommentId(commentId);
      if (parsedCommentId === null) {
        return errorResponse('VALIDATION_ERROR', 'comment_id inválido', 400);
      }

      const existing = await prisma.sesiones_comentarios.findUnique({ where: { id: parsedCommentId } });
      if (!existing || existing.sesion_id !== sessionIdStr) {
        return errorResponse('NOT_FOUND', 'Comentario no encontrado', 404);
      }

      if (existing.author && requestUser && existing.author !== requestUser) {
        return errorResponse('FORBIDDEN', 'No puedes editar este comentario', 403);
      }

      const { content, compartir_formador } = JSON.parse(event.body || '{}');
      const trimmedContent = typeof content === 'string' ? content.trim() : null;
      const compartirFormadorValue = parseCompartirFormador(compartir_formador);

      if (trimmedContent !== null && !trimmedContent.length) {
        return errorResponse('VALIDATION_ERROR', 'content requerido', 400);
      }

      const data: any = {};
      if (trimmedContent !== null) {
        data.content = trimmedContent;
      }
      if (compartirFormadorValue !== null) {
        data.compartir_formador = compartirFormadorValue;
      }

      if (!Object.keys(data).length) {
        return successResponse({ comment: mapCommentForResponse(existing) });
      }

      data.updated_at = nowInMadridDate();

      const updated = await prisma.sesiones_comentarios.update({
        where: { id: parsedCommentId },
        data,
      });

      return successResponse({ comment: mapCommentForResponse(updated) });
    }

    if (method === 'DELETE' && commentId) {
      const parsedCommentId = parseCommentId(commentId);
      if (parsedCommentId === null) {
        return errorResponse('VALIDATION_ERROR', 'comment_id inválido', 400);
      }

      const existing = await prisma.sesiones_comentarios.findUnique({ where: { id: parsedCommentId } });
      if (!existing || existing.sesion_id !== sessionIdStr) {
        return errorResponse('NOT_FOUND', 'Comentario no encontrado', 404);
      }

      if (existing.author && requestUser && existing.author !== requestUser) {
        return errorResponse('FORBIDDEN', 'No puedes eliminar este comentario', 403);
      }

      await prisma.sesiones_comentarios.delete({ where: { id: parsedCommentId } });

      return successResponse({ deleted: true });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (e: any) {
    const message = e?.message || 'Unexpected';
    return errorResponse('UNEXPECTED', message, 500);
  }
};
