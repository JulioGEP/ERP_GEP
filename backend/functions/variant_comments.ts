// backend/functions/variant_comments.ts
import { validate as isUUID } from 'uuid';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';
import { nowInMadridDate, toMadridISOString } from './_shared/timezone';

const DEFAULT_AUTHOR = process.env.DEFAULT_NOTE_AUTHOR || 'erp_user';

function parsePath(path: string) {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?variant_comments\/([^/]+)(?:\/([^/]+))?$/i);
  const variantId = match?.[1] ? decodeURIComponent(match[1]) : null;
  const commentId = match?.[2] ? decodeURIComponent(match[2]) : null;
  return { variantId, commentId };
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
    variant_id: comment.variant_id,
    content: comment.content,
    author: comment.author ?? DEFAULT_AUTHOR,
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
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
    }

    const { variantId, commentId } = parsePath(event.path || '');
    if (!variantId) {
      return errorResponse('VALIDATION_ERROR', 'variant_id requerido en path', 400);
    }

    const prisma = getPrisma();
    const variantIdStr = String(variantId).trim();
    if (!variantIdStr || !isUUID(variantIdStr)) {
      return errorResponse('VALIDATION_ERROR', 'variant_id inválido (UUID requerido)', 400);
    }

    const method = event.httpMethod;
    const requestUser =
      headerValue(event, 'X-User-Name')?.trim() || headerValue(event, 'X-User-Id')?.trim() || null;

    if (method === 'GET' && !commentId) {
      const variant = await prisma.variants.findUnique({
        where: { id: variantIdStr },
        select: { id: true },
      });
      if (!variant) {
        return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);
      }

      const comments = await prisma.variant_comments.findMany({
        where: { variant_id: variantIdStr },
        orderBy: { created_at: 'desc' },
      });

      return successResponse({ comments: comments.map(mapCommentForResponse) });
    }

    if (method === 'POST' && !commentId) {
      if (!event.body) return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);

      const variant = await prisma.variants.findUnique({
        where: { id: variantIdStr },
        select: { id: true },
      });
      if (!variant) {
        return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);
      }

      const { content } = JSON.parse(event.body || '{}');
      const trimmedContent = typeof content === 'string' ? content.trim() : '';
      if (!trimmedContent.length) {
        return errorResponse('VALIDATION_ERROR', 'content requerido', 400);
      }

      const author = requestUser && requestUser.length ? requestUser : DEFAULT_AUTHOR;
      const now = nowInMadridDate();

      const created = await prisma.variant_comments.create({
        data: {
          variant_id: variantIdStr,
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

      const parsedCommentId = parseCommentId(commentId);
      if (parsedCommentId === null) {
        return errorResponse('VALIDATION_ERROR', 'comment_id inválido', 400);
      }

      const existing = await prisma.variant_comments.findUnique({ where: { id: parsedCommentId } });
      if (!existing || existing.variant_id !== variantIdStr) {
        return errorResponse('NOT_FOUND', 'Comentario no encontrado', 404);
      }

      if (existing.author && requestUser && existing.author !== requestUser) {
        return errorResponse('FORBIDDEN', 'No puedes editar este comentario', 403);
      }

      const { content } = JSON.parse(event.body || '{}');
      const trimmedContent = typeof content === 'string' ? content.trim() : null;

      if (trimmedContent !== null && !trimmedContent.length) {
        return errorResponse('VALIDATION_ERROR', 'content requerido', 400);
      }

      const data: any = {};
      if (trimmedContent !== null) {
        data.content = trimmedContent;
      }

      if (!Object.keys(data).length) {
        return successResponse({ comment: mapCommentForResponse(existing) });
      }

      data.updated_at = nowInMadridDate();

      const updated = await prisma.variant_comments.update({
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

      const existing = await prisma.variant_comments.findUnique({ where: { id: parsedCommentId } });
      if (!existing || existing.variant_id !== variantIdStr) {
        return errorResponse('NOT_FOUND', 'Comentario no encontrado', 404);
      }

      if (existing.author && requestUser && existing.author !== requestUser) {
        return errorResponse('FORBIDDEN', 'No puedes eliminar este comentario', 403);
      }

      await prisma.variant_comments.delete({ where: { id: parsedCommentId } });

      return successResponse({ deleted: true });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (e: any) {
    const message = e?.message || 'Unexpected';
    return errorResponse('UNEXPECTED', message, 500);
  }
};
