import * as nodeCrypto from 'crypto'
import { COMMON_HEADERS, successResponse, errorResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';

const EDITABLE_FIELDS = new Set(['sede_label', 'hours', 'training_address', 'caes_label', 'fundae_label', 'hotel_label', 'alumnos']);

function parsePathId(path: any) {
  const m = String(path || '').match(/\/\.netlify\/functions\/deals\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function importDealFromPipedrive(dealIdRaw: any) {
  const prisma = getPrisma();
  const dealId = String(dealIdRaw ?? '').trim();
  if (!dealId) throw new Error('Falta dealId');

  const base = process.env.PIPEDRIVE_BASE_URL!;
  const token = process.env.PIPEDRIVE_API_TOKEN!;
  if (!base || !token) throw new Error('Pipedrive no configurado');

  const res = await fetch(`${base}/deals/${dealId}?api_token=${token}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Pipedrive ${res.status}: ${txt}`);
  }
  const json = await res.json();
  const d = json?.data;
  if (!d) throw new Error('Deal no encontrado en Pipedrive');

  // Normaliza con vuestras convenciones vigentes
  const normalized = {
    deal_id: d.id,
    title: d.title ?? '',
    pipeline_id: d.pipeline_id ?? null,
    training_address: d?.deal_direction ?? d?.training_address ?? null,
    sede_label: d?.Sede ?? d?.sede_label ?? null,
    caes_label: d?.CAES ?? d?.caes_label ?? null,
    fundae_label: d?.FUNDAE ?? d?.fundae_label ?? null,
    hotel_label: d?.Hotel_Night ?? d?.hotel_label ?? null,
    hours: Number(d?.hours ?? 0) || 0,
    alumnos: Number(d?.alumnos ?? 0) || 0,
    org_id: d?.org_id?.value ?? d?.org_id ?? null,
    org_name: d?.org_name ?? null,
    person_id: d?.person_id?.value ?? d?.person_id ?? null,
    person_name: d?.person_name ?? null,
    person_email: d?.person_email ?? null,
    person_phone: d?.person_phone ?? null
  };

  let orgConnect: any = undefined;
  if (normalized.org_id) {
    const org = await prisma.organizations.upsert({
      where: { org_id: normalized.org_id },
      update: { name: normalized.org_name ?? undefined },
      create: { org_id: normalized.org_id, name: normalized.org_name ?? '' }
    });
    orgConnect = { connect: { org_id: org.org_id } };
  }

  let personConnect: any = undefined;
  if (normalized.person_id) {
    const person = await prisma.persons.upsert({
      where: { person_id: normalized.person_id },
      update: {
        name: normalized.person_name ?? undefined,
        email: normalized.person_email ?? undefined,
        phone: normalized.person_phone ?? undefined
      },
      create: {
        person_id: normalized.person_id,
        name: normalized.person_name ?? '',
        email: normalized.person_email ?? null,
        phone: normalized.person_phone ?? null
      }
    });
    personConnect = { connect: { person_id: person.person_id } };
  }

  const saved = await prisma.deals.upsert({
    where: { deal_id: normalized.deal_id },
    update: {
      title: normalized.title,
      pipeline_id: normalized.pipeline_id,
      training_address: normalized.training_address,
      sede_label: normalized.sede_label,
      caes_label: normalized.caes_label,
      fundae_label: normalized.fundae_label,
      hotel_label: normalized.hotel_label,
      hours: normalized.hours,
      alumnos: normalized.alumnos,
      ...(orgConnect ? { organization: orgConnect } : {}),
      ...(personConnect ? { person: personConnect } : {})
    },
    create: {
      deal_id: normalized.deal_id,
      title: normalized.title,
      pipeline_id: normalized.pipeline_id,
      training_address: normalized.training_address,
      sede_label: normalized.sede_label,
      caes_label: normalized.caes_label,
      fundae_label: normalized.fundae_label,
      hotel_label: normalized.hotel_label,
      hours: normalized.hours,
      alumnos: normalized.alumnos,
      ...(orgConnect ? { organization: orgConnect } : {}),
      ...(personConnect ? { person: personConnect } : {})
    },
    select: {
      deal_id: true,
      title: true,
      organization: { select: { org_id: true, name: true } },
      person: { select: { person_id: true, name: true, email: true, phone: true } }
    }
  });

  return saved;
}

export const handler = async (event: any) => {
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

    // --- IMPORT: POST /.netlify/functions/deals/import  (y GET con ?dealId= para debug)
    if ((method === 'POST' && path.endsWith('/deals/import')) ||
        (method === 'GET' && path.endsWith('/deals/import'))) {
      const body = event.body ? JSON.parse(event.body) : {};
      const incomingId = body?.dealId ?? body?.id ?? body?.deal_id ?? event.queryStringParameters?.dealId;
      if (!incomingId) return errorResponse('VALIDATION_ERROR', 'Falta dealId', 400);

      try {
        const saved = await importDealFromPipedrive(incomingId);
        return successResponse({ ok: true, deal: saved });
      } catch (e: any) {
        return errorResponse('IMPORT_ERROR', e?.message || 'Error importando deal', 502);
      }
    }

    // --- GET detalle: /.netlify/functions/deals/:id  o  /.netlify/functions/deals?dealId= ---
    if (method === 'GET' && dealId !== null) {
      const deal = await prisma.deals.findUnique({
        where: { deal_id: dealId },
        include: {
          comments: { orderBy: { created_at: 'desc' } },
          organization: true
        }
      });
      if (!deal) return errorResponse('NOT_FOUND', 'Deal no encontrado', 404);

      const [products, notes, person, files] = await Promise.all([
        prisma.deal_products.findMany({
          where: { deal_id: dealId },
          orderBy: { created_at: 'asc' },
          select: {
            id: true,
            deal_id: true,
            product_id: true,
            name: true,
            code: true,
            category: true,
            quantity: true,
            price: true,
            is_training: true,
            type: true,
            hours: true,
            created_at: true,
            updated_at: true
          }
        }),
        prisma.deal_notes.findMany({
          where: { deal_id: dealId },
          orderBy: { created_at: 'desc' }
        }),
        deal.person_id ? prisma.persons.findUnique({ where: { person_id: deal.person_id } }) : null,
        prisma.deal_files.findMany({ where: { deal_id: dealId } })
      ]);

      const normalizedProducts = products.map((p: any) => ({
        ...p,
        quantity: p.quantity != null ? Number(p.quantity) : null,
        price: p.price != null ? Number(p.price) : null,
        hours: p.hours != null ? Number(p.hours) : null,
        code: p.code ?? null,
        category: p.category ?? null,
        type: p.type ?? null,
        created_at: p.created_at?.toISOString?.() ?? p.created_at,
        updated_at: p.updated_at?.toISOString?.() ?? p.updated_at
      }));

      const normalizedNotes = notes.map((n: any) => ({
        ...n,
        created_at: n.created_at?.toISOString?.() ?? n.created_at,
        updated_at: n.updated_at?.toISOString?.() ?? n.updated_at
      }));

      const hoursFromProducts = (() => {
        const byHours = normalizedProducts.reduce((acc: number, p: any) => acc + (Number(p.hours) || 0), 0);
        if (byHours > 0) return byHours;
        return normalizedProducts.reduce((acc: number, p: any) => acc + (Number(p.quantity) || 0), 0) || null;
      })();

      const normalizedDocs = files.map((f: any) => ({
        id: f.id,
        doc_id: f.id,
        file_name: f.file_name ?? null,
        fileName: f.file_name ?? null,
        file_size: (f as any).file_size ?? null,
        fileSize: (f as any).file_size ?? null,
        mime_type: (f as any).mime_type ?? null,
        mimeType: (f as any).mime_type ?? null,
        storage_key: f.file_url ?? null,
        storageKey: f.file_url ?? null,
        origin: 'user_upload'
      }));

      const { organization, ...rest } = deal as any;
      const normalizedDeal: any = {
        ...rest,
        hours: (rest as any).hours ?? hoursFromProducts,
        org_id: deal.org_id != null ? String(deal.org_id) : null,
        organization: organization
          ? {
              ...organization,
              org_id: organization.org_id != null ? String(organization.org_id) : null
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
          organization: { select: { org_id: true, name: true } },
          created_at: true
        },
        orderBy: { created_at: 'desc' }
      });

      const dealIds = deals.map((d: any) => d.deal_id);

      const products = dealIds.length
        ? await prisma.deal_products.findMany({
            where: { deal_id: { in: dealIds } },
            select: {
              id: true,
              deal_id: true,
              product_id: true,
              name: true,
              code: true,
              category: true,
              quantity: true,
              price: true,
              is_training: true,
              type: true,
              hours: true,
              created_at: true
            },
            orderBy: { created_at: 'asc' }
          })
        : [];

      const productsByDeal = new Map<string, any[]>();
      for (const product of products) {
        const key = product.deal_id || '';
        const list = productsByDeal.get(key) || [];
        list.push({
          ...product,
          quantity: product.quantity != null ? Number(product.quantity) : null,
          price: product.price != null ? Number(product.price) : null,
          hours: product.hours != null ? Number(product.hours) : null
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

      const rows = deals.map((d: any) => {
        const prods = productsByDeal.get(d.deal_id) || [];
        const computedHours = (() => {
          const sumH = prods.reduce((acc: number, p: any) => acc + (Number(p.hours) || 0), 0);
          if (sumH > 0) return sumH;
          const sumQty = prods.reduce((acc: number, p: any) => acc + (Number(p.quantity) || 0), 0);
          return sumQty || null;
        })();

        return {
          deal_id: d.deal_id,
          title: d.title || '',
          sede_label: d.sede_label || '',
          pipeline_id: d.pipeline_id || null,
          training_address: d.training_address || null,
          hours: d.hours ?? computedHours,
          alumnos: d.alumnos ?? null,
          caes_label: d.caes_label || null,
          fundae_label: d.fundae_label || null,
          hotel_label: d.hotel_label || null,
          prodextra: d.prodextra ?? null,
          org_id: d.org_id != null ? String(d.org_id) : null,
          organization: d.organization
            ? {
                ...d.organization,
                org_id: d.organization.org_id != null ? String(d.organization.org_id) : null
              }
            : null,
          person: d.person_id ? personById.get(d.person_id) || null : null,
          deal_products: prods
        };
      });

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
