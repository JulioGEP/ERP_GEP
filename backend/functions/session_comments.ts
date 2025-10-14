// backend/functions/session_comments.ts
import { randomUUID } from 'crypto';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';
import { nowInMadridISO, toMadridISOString } from './_shared/timezone';

const DEFAULT_AUTHOR = process.env.DEFAULT_NOTE_AUTHOR || 'erp_user';

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
    id: comment.id,
    deal_id: comment.deal_id,
    sesion_id: comment.sesion_id,
    content: comment.content,
    author: comment.author,
    created_at: toMadridISOString(comment.created_at),
    updated_at: toMadridISOString(comment.updated_at),
  };
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
    }

    const { sessionId, commentId } = parsePath(event.path || '');
    if (!sessionId) {
      return errorResponse('VALIDATION_ERROR', 'session_id requerido en path', 400);
    }

    const prisma = getPrisma();
    const sessionIdStr = String(sessionId).trim();
    if (!sessionIdStr) {
      return errorResponse('VALIDATION_ERROR', 'session_id inválido', 400);
    }

    const method = event.httpMethod;
    const requestUser =
      headerValue(event, 'X-User-Name')?.trim() || headerValue(event, 'X-User-Id')?.trim() || null;

    if (method === 'GET' && !commentId) {
      const session = await prisma.sessions.findUnique({
        where: { id: sessionIdStr },
        select: { id: true },
      });
      if (!session) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
      }

      const comments = await prisma.session_comments.findMany({
        where: { sesion_id: sessionIdStr },
        orderBy: { created_at: 'desc' },
      });

      return successResponse({ comments: comments.map(mapCommentForResponse) });
    }

    if (method === 'POST' && !commentId) {
      if (!event.body) return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);

      const session = await prisma.sessions.findUnique({
        where: { id: sessionIdStr },
        select: { id: true, deal_id: true },
      });
      if (!session) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
      }

      const { content } = JSON.parse(event.body || '{}');
      const trimmedContent = typeof content === 'string' ? content.trim() : '';
      if (!trimmedContent.length) {
        return errorResponse('VALIDATION_ERROR', 'content requerido', 400);
      }

      const author = requestUser && requestUser.length ? requestUser : DEFAULT_AUTHOR;
      const now = nowInMadridISO();

      const created = await prisma.session_comments.create({
        data: {
          id: randomUUID(),
          deal_id: session.deal_id,
          sesion_id: session.id,
          content: trimmedContent,
          author,
          created_at: now,
          updated_at: now,
        },
      });

      return successResponse({ comment: mapCommentForResponse(created) }, 201);
    }

    if (method === 'PATCH' && commentId) {
      if (!event.body) return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);

      const existing = await prisma.session_comments.findUnique({ where: { id: String(commentId) } });
      if (!existing || existing.sesion_id !== sessionIdStr) {
        return errorResponse('NOT_FOUND', 'Comentario no encontrado', 404);
      }

      if (existing.author && requestUser && existing.author !== requestUser) {
        return errorResponse('FORBIDDEN', 'No puedes editar este comentario', 403);
      }

      const { content } = JSON.parse(event.body || '{}');
      const trimmedContent = typeof content === 'string' ? content.trim() : '';
      if (!trimmedContent.length) {
        return errorResponse('VALIDATION_ERROR', 'content requerido', 400);
      }

      const updated = await prisma.session_comments.update({
        where: { id: String(commentId) },
        data: {
          content: trimmedContent,
          updated_at: nowInMadridISO(),
        },
      });

      return successResponse({ comment: mapCommentForResponse(updated) });
    }

    if (method === 'DELETE' && commentId) {
      const existing = await prisma.session_comments.findUnique({ where: { id: String(commentId) } });
      if (!existing || existing.sesion_id !== sessionIdStr) {
        return errorResponse('NOT_FOUND', 'Comentario no encontrado', 404);
      }

      if (existing.author && requestUser && existing.author !== requestUser) {
        return errorResponse('FORBIDDEN', 'No puedes eliminar este comentario', 403);
      }

      await prisma.session_comments.delete({ where: { id: String(commentId) } });

      return successResponse({ deleted: true });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (e: any) {
    const message = e?.message || 'Unexpected';
    return errorResponse('UNEXPECTED', message, 500);
  }
};
