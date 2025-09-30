const crypto = require('crypto');
const { COMMON_HEADERS, successResponse, errorResponse } = require('./_shared/response');
const { getPrisma } = require('./_shared/prisma');

const EDITABLE_FIELDS = new Set(['sede', 'hours', 'deal_direction', 'CAES', 'FUNDAE', 'Hotel_Night', 'alumnos']);

function parsePathId(path) {
  const m = path.match(/\/\.netlify\/functions\/deals\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

exports.handler = async (event) => {
  try {
    // Preflight CORS
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
    }

    const prisma = getPrisma();
    const method = event.httpMethod;
    const path = event.path || '';
    const dealId = parsePathId(path);

    // --- GET detalle: /.netlify/functions/deals/:id ---
    if (method === 'GET' && dealId !== null) {
      const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        include: {
          organization: true,
          documents: true,
          comments: { orderBy: { createdAt: 'desc' } }
        }
      });
      if (!deal) return errorResponse('NOT_FOUND', 'Deal no encontrado', 404);
      return successResponse({ deal });
    }

    // --- PATCH edición parcial (solo 7 campos) + comentarios ---
    if (method === 'PATCH' && dealId !== null) {
      if (!event.body) return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      const userId = event.headers['x-user-id'] || event.headers['X-User-Id'];
      const userName = event.headers['x-user-name'] || event.headers['X-User-Name'];
      if (!userId) return errorResponse('UNAUTHORIZED', 'X-User-Id requerido', 401);

      const body = JSON.parse(event.body || '{}');

      // Deal patch
      const patch = {};
      if (body.deal && typeof body.deal === 'object') {
        for (const k of Object.keys(body.deal)) {
          if (EDITABLE_FIELDS.has(k)) patch[k] = body.deal[k];
        }
      }
      if ('hours' in patch && (isNaN(patch.hours) || Number(patch.hours) < 0)) {
        return errorResponse('VALIDATION_ERROR', 'hours inválido', 400);
      }
      if ('alumnos' in patch && (isNaN(patch.alumnos) || Number(patch.alumnos) < 0)) {
        return errorResponse('VALIDATION_ERROR', 'alumnos inválido', 400);
      }

      const creates = (body.comments && Array.isArray(body.comments.create)) ? body.comments.create : [];
      const updates = (body.comments && Array.isArray(body.comments.update)) ? body.comments.update : [];

      await prisma.$transaction(async (tx) => {
        if (Object.keys(patch).length) {
          const data = { ...patch };
          if ('hours' in data) data.hours = Number(data.hours);
          if ('alumnos' in data) data.alumnos = Number(data.alumnos);
          await tx.deal.update({ where: { id: dealId }, data });
        }

        if (creates.length) {
          const rows = creates
            .map((c) => ({
              dealId,
              authorId: String(userId),
              authorName: c.author_name || userName || null,
              content: String(c.content || '').trim()
            }))
            .filter((c) => c.content.length > 0);
          if (rows.length) {
            await tx.comment.createMany({ data: rows });
          }
        }

        if (updates.length) {
          for (const u of updates) {
            const row = await tx.comment.findUnique({ where: { id: u.comment_id } });
            if (!row) throw new Error('COMMENT_NOT_FOUND');
            if (row.authorId !== String(userId)) throw new Error('FORBIDDEN_COMMENT_EDIT');
            await tx.comment.update({
              where: { id: u.comment_id },
              data: { content: String(u.content || '').trim() }
            });
          }
        }
      });

      return successResponse({ ok: true });
    }

    // --- GET listado para la tabla: /.netlify/functions/deals?noSessions=true ---
    if (method === 'GET' && (event.queryStringParameters?.noSessions === 'true')) {
      // Devuelve solo columnas Presupuesto | Cliente | Sede | Producto (+ id interno para abrir popup)
      const deals = await prisma.deal.findMany({
        where: { sessions: { none: {} } },
        select: {
          id: true,
          title: true,
          training: true,
          sede: true,
          organization: { select: { name: true } },
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });

      const rows = deals.map((d) => ({
        deal_id: d.id,
        presupuesto: d.id != null ? String(d.id) : '',
        title: d.title || '',
        deal_title: d.title || '',
        cliente: d.organization?.name || '',
        sede: d.sede || '',
        producto: d.training || ''
      }));

      return successResponse({ deals: rows });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (e) {
    const message = e?.message || 'Unexpected';
    if (message === 'COMMENT_NOT_FOUND') return errorResponse('NOT_FOUND', 'Comentario no existe', 404);
    if (message === 'FORBIDDEN_COMMENT_EDIT') return errorResponse('FORBIDDEN', 'No puedes editar comentarios de otros', 403);
    return errorResponse('UNEXPECTED', message, 500);
  }
};
