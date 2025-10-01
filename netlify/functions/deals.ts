const crypto = require('crypto');
const { COMMON_HEADERS, successResponse, errorResponse } = require('./_shared/response');
const { getPrisma } = require('./_shared/prisma');

const EDITABLE_FIELDS = new Set(['sede_label', 'hours', 'training_address', 'caes_label', 'fundae_label', 'hotel_label', 'alumnos']);

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
      const deal = await prisma.deals.findUnique({
        where: { deal_id: dealId },
        include: {
          documents: true,
          comments: { orderBy: { created_at: 'desc' } },
          organizations: true
        }
      });
      if (!deal) return errorResponse('NOT_FOUND', 'Deal no encontrado', 404);

      const [products, notes, person] = await Promise.all([
        prisma.deal_products.findMany({
          where: { deal_id: dealId },
          orderBy: { created_at: 'asc' }
        }),
        prisma.deal_notes.findMany({
          where: { deal_id: dealId },
          orderBy: { created_at: 'desc' }
        }),
        deal.person_id ? prisma.persons.findUnique({ where: { person_id: deal.person_id } }) : null
      ]);

      const normalizedProducts = products.map((product) => ({
        ...product,
        quantity: product.quantity != null ? Number(product.quantity) : null,
        created_at: product.created_at?.toISOString?.() ?? product.created_at,
        updated_at: product.updated_at?.toISOString?.() ?? product.updated_at
      }));

      const normalizedNotes = notes.map((note) => ({
        ...note,
        created_at: note.created_at?.toISOString?.() ?? note.created_at,
        updated_at: note.updated_at?.toISOString?.() ?? note.updated_at
      }));

      const { organizations, ...rest } = deal;
      const normalizedDeal: any = {
        ...rest,
        org_id: deal.org_id != null ? String(deal.org_id) : null,
        organization: organizations
          ? {
              ...organizations,
              org_id: organizations.org_id != null ? String(organizations.org_id) : null
            }
          : null,
        deal_products: normalizedProducts,
        deal_notes: normalizedNotes,
        person: person
          ? {
              ...person,
              person_id: person.person_id,
              first_name: person.first_name ?? null,
              last_name: person.last_name ?? null,
              email: person.email ?? null,
              phone: person.phone ?? null
            }
          : null
      };

      return successResponse({ deal: normalizedDeal });
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
      if ('hours' in patch) {
        const value = patch.hours;
        if (value !== null && (isNaN(value) || Number(value) < 0)) {
          return errorResponse('VALIDATION_ERROR', 'hours inválido', 400);
        }
      }
      if ('alumnos' in patch) {
        const value = patch.alumnos;
        if (value !== null && (isNaN(value) || Number(value) < 0)) {
          return errorResponse('VALIDATION_ERROR', 'alumnos inválido', 400);
        }
      }

      const creates = (body.comments && Array.isArray(body.comments.create)) ? body.comments.create : [];
      const updates = (body.comments && Array.isArray(body.comments.update)) ? body.comments.update : [];

      await prisma.$transaction(async (tx) => {
        if (Object.keys(patch).length) {
          const data: Record<string, any> = { ...patch };
          if ('hours' in data) data.hours = data.hours === null ? null : Number(data.hours);
          if ('alumnos' in data) data.alumnos = data.alumnos === null ? null : Number(data.alumnos);
          await tx.deals.update({ where: { deal_id: dealId }, data });
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
            await tx.comments.createMany({ data: rows });
          }
        }

        if (updates.length) {
          for (const u of updates) {
            const row = await tx.comments.findUnique({ where: { id: u.comment_id } });
            if (!row) throw new Error('COMMENT_NOT_FOUND');
            if (row.authorId !== String(userId)) throw new Error('FORBIDDEN_COMMENT_EDIT');
            await tx.comments.update({
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
      const deals = await prisma.deals.findMany({
        where: { seassons: { none: {} } },
        select: {
          deal_id: true,
          title: true,
          sede_label: true,
          pipeline_id: true,
          training_address: true,
          hours: true,
          alumnos: true,
          caes_label: true,
          fundae_label: true,
          hotel_label: true,
          prodextra: true,
          org_id: true,
          person_id: true,
          organizations: { select: { org_id: true, name: true } },
          created_at: true
        },
        orderBy: { created_at: 'desc' }
      });

      const dealIds = deals.map((d) => d.deal_id);
      const products = dealIds.length
        ? await prisma.deal_products.findMany({
            where: { deal_id: { in: dealIds } },
            select: { id: true, deal_id: true, name: true, code: true, quantity: true },
            orderBy: { created_at: 'asc' }
          })
        : [];
      const productsByDeal = new Map();
      for (const product of products) {
        const key = product.deal_id || '';
        const list = productsByDeal.get(key) || [];
        list.push({
          ...product,
          quantity: product.quantity != null ? Number(product.quantity) : null
        });
        productsByDeal.set(key, list);
      }

      const personIds = deals.map((d) => d.person_id).filter((id): id is string => Boolean(id));
      const persons = personIds.length
        ? await prisma.persons.findMany({
            where: { person_id: { in: personIds } },
            select: { person_id: true, first_name: true, last_name: true, email: true, phone: true }
          })
        : [];
      const personById = new Map(persons.map((p) => [p.person_id, p]));

      const rows = deals.map((d) => ({
        deal_id: d.deal_id,
        title: d.title || '',
        sede_label: d.sede_label || '',
        pipeline_id: d.pipeline_id || null,
        training_address: d.training_address || null,
        hours: d.hours ?? null,
        alumnos: d.alumnos ?? null,
        caes_label: d.caes_label || null,
        fundae_label: d.fundae_label || null,
        hotel_label: d.hotel_label || null,
        prodextra: d.prodextra ?? null,
        org_id: d.org_id != null ? String(d.org_id) : null,
        organization: d.organizations
          ? {
              ...d.organizations,
              org_id: d.organizations.org_id != null ? String(d.organizations.org_id) : null
            }
          : null,
        person: d.person_id ? personById.get(d.person_id) || null : null,
        deal_products: productsByDeal.get(d.deal_id) || []
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
