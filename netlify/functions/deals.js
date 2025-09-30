const { COMMON_HEADERS, successResponse, errorResponse } = require('./_shared/response');
const { getPrisma } = require('./_shared/prisma');

const EDITABLE = new Set(['sede','hours','deal_direction','CAES','FUNDAE','Hotel_Night','alumnos']);

function dealIdFromPath(path) {
  const m = path.match(/\/\.netlify\/functions\/deals\/([^\/\?]+)/);
  return m ? m[1] : null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: COMMON_HEADERS, body: '' };

    const prisma = getPrisma();
    const method = event.httpMethod;
    const path = event.path || '';
    const dealId = dealIdFromPath(path);

    // === LISTADO para la tabla ===
    if (method === 'GET' && !dealId) {
      const wantNoSessions = event.queryStringParameters?.noSessions === 'true';

      const selectCols = {
        deal_id: true,
        deal_title: true,
        organization: { select: { name: true } },
        sede: true,
        training: true,
        created_at: true
      };

      let rows = [];
      if (wantNoSessions) {
        rows = await prisma.deals.findMany({
          where: { seassons: { none: {} } },
          select: selectCols,
          orderBy: { created_at: 'desc' }
        });
        // Fallback: si no hay “sin sesiones”, devuelve todos para que la UI no quede vacía.
        if (rows.length === 0) {
          rows = await prisma.deals.findMany({
            select: selectCols,
            orderBy: { created_at: 'desc' }
          });
        }
      } else {
        rows = await prisma.deals.findMany({
          select: selectCols,
          orderBy: { created_at: 'desc' }
        });
      }

      const mapped = rows.map(d => ({
        deal_id: d.deal_id,
        presupuesto: d.deal_title ?? d.deal_id,
        cliente: d.organization?.name ?? '',
        sede: d.sede ?? '',
        producto: d.training ?? ''
      }));

      return successResponse({ deals: mapped });
    }

    // === DETALLE ===
    if (method === 'GET' && dealId) {
      const deal = await prisma.deals.findUnique({
        where: { deal_id: dealId },
        include: {
          organization: true,
          documents: true,
          comments: { orderBy: { created_at: 'desc' } }
        }
      });
      if (!deal) return errorResponse('NOT_FOUND','Deal no encontrado',404);
      return successResponse({ deal });
    }

    // === PATCH (solo 7 campos + comentarios del propio autor) ===
    if (method === 'PATCH' && dealId) {
      const userId = event.headers['x-user-id'] || event.headers['X-User-Id'];
      const userName = event.headers['x-user-name'] || event.headers['X-User-Name'];
      if (!userId) return errorResponse('UNAUTHORIZED','X-User-Id requerido',401);
      if (!event.body) return errorResponse('VALIDATION_ERROR','Body requerido',400);

      const body = JSON.parse(event.body || '{}');
      const patch = {};
      if (body.deal && typeof body.deal === 'object') {
        for (const k of Object.keys(body.deal)) {
          if (EDITABLE.has(k)) patch[k] = body.deal[k];
        }
      }
      if ('hours' in patch && (isNaN(patch.hours) || Number(patch.hours) < 0)) return errorResponse('VALIDATION_ERROR','hours inválido',400);
      if ('alumnos' in patch && (isNaN(patch.alumnos) || Number(patch.alumnos) < 0)) return errorResponse('VALIDATION_ERROR','alumnos inválido',400);

      const creates = body?.comments?.create ?? [];
      const updates = body?.comments?.update ?? [];

      await prisma.$transaction(async (tx) => {
        if (Object.keys(patch).length) {
          const data = { ...patch };
          if ('hours' in data) data.hours = Number(data.hours);
          if ('alumnos' in data) data.alumnos = Number(data.alumnos);
          await tx.deals.update({ where: { deal_id: dealId }, data });
        }

        if (creates.length) {
          const rows = creates
            .map(c => ({
              deal_id: dealId,
              author_id: String(userId),
              author_name: c.author_name || userName || null,
              content: String(c.content || '').trim()
            }))
            .filter(c => c.content.length > 0);
          if (rows.length) await tx.comments.createMany({ data: rows });
        }

        if (updates.length) {
          for (const u of updates) {
            const row = await tx.comments.findUnique({ where: { comment_id: u.comment_id } });
            if (!row) throw new Error('COMMENT_NOT_FOUND');
            if (row.author_id !== String(userId)) throw new Error('FORBIDDEN_COMMENT_EDIT');
            await tx.comments.update({ where: { comment_id: u.comment_id }, data: { content: String(u.content || '').trim() } });
          }
        }
      });

      return successResponse();
    }

    return errorResponse('NOT_IMPLEMENTED','Ruta o método no soportado',404);
  } catch (e) {
    const msg = e?.message || 'Unexpected';
    if (msg === 'COMMENT_NOT_FOUND') return errorResponse('NOT_FOUND','Comentario no existe',404);
    if (msg === 'FORBIDDEN_COMMENT_EDIT') return errorResponse('FORBIDDEN','No puedes editar comentarios de otros',403);
    return errorResponse('UNEXPECTED_ERROR', msg, 500);
  }
};
