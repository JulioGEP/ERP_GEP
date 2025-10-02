import * as nodeCrypto from 'crypto'
const { COMMON_HEADERS, successResponse, errorResponse } = require('./_shared/response');
const { getPrisma } = require('./_shared/prisma');

const EDITABLE_FIELDS = new Set(['sede_label', 'hours', 'training_address', 'caes_label', 'fundae_label', 'hotel_label', 'alumnos'])

function parsePathId(path: any) {
  const m = path.match(/\/\.netlify\/functions\/deals\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export const handler = async (event: any, context: any) => {
  try {
    // Preflight CORS
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
    }

    const prisma = getPrisma();
    const method = event.httpMethod;
    const path = event.path || '';

    // Soporta id por PATH y también por QUERY (?dealId=)
    const qsId = event.queryStringParameters?.dealId
      ? String(event.queryStringParameters.dealId).trim()
      : null;
    const dealId = parsePathId(path) ?? (qsId && qsId.length ? qsId : null);

    // --- GET detalle: /.netlify/functions/deals/:id  o  /.netlify/functions/deals?dealId= ---
    if (method === 'GET' && dealId !== null) {
      const deal = await prisma.deals.findUnique({
        where: { deal_id: dealId },
        include: {
          // documents: true, // ❌ NO existe "documents" en tu BBDD
          comments: { orderBy: { created_at: 'desc' } },
          organizations: true
        }
      });
      if (!deal) return errorResponse('NOT_FOUND', 'Deal no encontrado', 404);

      const [products, notes, person, files] = await Promise.all([
        prisma.deal_products.findMany({
          where: { deal_id: dealId },
          orderBy: { created_at: 'asc' }
        }),
        prisma.deal_notes.findMany({
          where: { deal_id: dealId },
          orderBy: { created_at: 'desc' }
        }),
        deal.person_id ? prisma.persons.findUnique({ where: { person_id: deal.person_id } }) : null,
        prisma.deal_files.findMany({
          where: { deal_id: dealId }
          // si tienes created_at en deal_files y quieres ordenar, descomenta:
          // orderBy: { created_at: 'desc' }
        })
      ]);

      const normalizedProducts = products.map((product: any) => ({
        ...product,
        quantity: product.quantity != null ? Number(product.quantity) : null,
        created_at: product.created_at?.toISOString?.() ?? product.created_at,
        updated_at: product.updated_at?.toISOString?.() ?? product.updated_at
      }));

      const normalizedNotes = notes.map((note: any) => ({
        ...note,
        created_at: note.created_at?.toISOString?.() ?? note.created_at,
        updated_at: note.updated_at?.toISOString?.() ?? note.updated_at
      }));
      const inferredHours = normalizedProducts.reduce((acc: number, p: any) => acc + (Number(p.quantity) || 0), 0) || null;
      const firstTrainingName = normalizedProducts.find((p: any) => (p.name && String(p.name).trim().length))?.name ?? null;

      // Mapeo de deal_files -> documents (forma que espera el front)
      const normalizedDocs = files.map((f: any) => ({
        id: f.id,
        doc_id: f.id,
        file_name: f.file_name ?? null,
        fileName: f.file_name ?? null,
        // si tu tabla tiene estos campos, los mostramos; si no, quedan null/0 y el front ya lo tolera
        file_size: (f as any).file_size ?? null,
        fileSize: (f as any).file_size ?? null,
        mime_type: (f as any).mime_type ?? null,
        mimeType: (f as any).mime_type ?? null,
        // usamos file_url como "storage_key" porque el front lo espera así para previsualizar
        storage_key: f.file_url ?? null,
        storageKey: f.file_url ?? null,
        // forzamos user_upload para que el botón "Eliminar" aparezca (si tu política lo permite)
        origin: 'user_upload'
      }));

      const { organizations, ...rest } = deal;
const normalizedDeal: any = {
  ...rest,
  // fuerza hours si no viene de DB
  hours: (rest as any).hours ?? inferredHours,
  org_id: deal.org_id != null ? String(deal.org_id) : null,
  organization: organizations
    ? {
        ...organizations,
        org_id: organizations.org_id != null ? String(organizations.org_id) : null
      }
    : null,
  deal_products: normalizedProducts,
  deal_notes: normalizedNotes,
  documents: normalizedDocs,
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

      // Deal patch (FIX: usar "patch", no "path")
      const patch: Record<string, any> = {};
      if (body.deal && typeof body.deal === 'object') {
        for (const k of Object.keys(body.deal)) {
          if (EDITABLE_FIELDS.has(k)) patch[k] = body.deal[k];
        }
      }
      if ('hours' in patch) {
        const value = patch.hours;
        if (value != null && (Number.isNaN(Number(value)) || Number(value) < 0)) {
          return errorResponse('VALIDATION_ERROR', 'hours inválido', 400);
        }
      }
      if ('alumnos' in patch) {
        const value = patch.alumnos;
        if (value != null && (Number.isNaN(Number(value)) || Number(value) < 0)) {
          return errorResponse('VALIDATION_ERROR', 'alumnos inválido', 400);
        }
      }

      const creates = (body.comments && Array.isArray(body.comments.create)) ? body.comments.create : [];
      const updates = (body.comments && Array.isArray(body.comments.update)) ? body.comments.update : [];

      await prisma.$transaction(async (tx: any) => {
        if (Object.keys(patch).length) {
          const data: Record<string, any> = { ...patch };
          if ('hours' in data) data.hours = data.hours === null ? null : Number(data.hours);
          if ('alumnos' in data) data.alumnos = data.alumnos === null ? null : Number(data.alumnos);
          await tx.deals.update({ where: { deal_id: dealId }, data });
        }

        if (creates.length) {
          const rows = creates
            .map((c: any) => ({
              dealId,
              authorId: String(userId),
              authorName: c.author_name || userName || null,
              content: String(c.content || '').trim()
            }))
            .filter((c: any) => c.content.length > 0);
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

      const dealIds = deals.map((d: any) => d.deal_id);
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

      const personIds = deals.map((d: any) => d.person_id).filter((id: any): id is string => Boolean(id));
      const persons = personIds.length
        ? await prisma.persons.findMany({
            where: { person_id: { in: personIds } },
            select: { person_id: true, first_name: true, last_name: true, email: true, phone: true }
          })
        : [];
      const personById = new Map(persons.map((p: any) => [p.person_id, p]));

      const rows = deals.map((d: any) => ({
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
  } catch (e: any) {
    const message = e?.message || 'Unexpected';
    if (message === 'COMMENT_NOT_FOUND') return errorResponse('NOT_FOUND', 'Comentario no existe', 404);
    if (message === 'FORBIDDEN_COMMENT_EDIT') return errorResponse('FORBIDDEN', 'No puedes editar comentarios de otros', 403);
    return errorResponse('UNEXPECTED', message, 500);
  }
};
