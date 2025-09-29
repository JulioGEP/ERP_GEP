const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const COMMON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

let prisma;
function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: COMMON_HEADERS, body: JSON.stringify(body) };
}

function sanitizeHtml(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function normalizeJsonArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [];
}

function mapDealRecord(record) {
  const training = normalizeJsonArray(record.training);
  const prodExtra = normalizeJsonArray(record.prodExtra);
  const documents = Array.isArray(record.documents) ? record.documents : [];
  const notes = Array.isArray(record.notes) ? record.notes : [];
  const trainingNames = training
    .map((product) => (product && typeof product.name === 'string' ? product.name : null))
    .filter(Boolean);
  const extraNames = prodExtra
    .map((product) => (product && typeof product.name === 'string' ? product.name : null))
    .filter(Boolean);

  return {
    deal_id: record.id,
    deal_org_id: record.organizationId,
    organization_name: record.organization?.name ?? 'Organización sin nombre',
    title: record.title,
    training_type: record.trainingType ?? null,
    training,
    training_names: trainingNames,
    hours: record.hours,
    deal_direction: record.direction ?? null,
    sede: record.sede ?? null,
    caes: record.caes ?? null,
    fundae: record.fundae ?? null,
    hotel_night: record.hotelNight ?? null,
    prod_extra: prodExtra,
    prod_extra_names: extraNames,
    documents_num: record.documentsNum ?? documents.length,
    documents_id: documents.map((doc) => doc.id),
    documents: documents.map((doc) => doc.title),
    notes_count: record.notesNum ?? notes.length,
    notes: notes.map((note) => sanitizeHtml(note.comment) ?? note.comment),
    created_at: record.createdAt?.toISOString?.() ?? record.createdAt,
    updated_at: record.updatedAt?.toISOString?.() ?? record.updatedAt
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  const requestId = crypto.randomUUID();

  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { error: 'method_not_allowed', message: 'Método no permitido' });
    }

    const noSessionsRaw = event.queryStringParameters?.noSessions ?? event.queryStringParameters?.no_sessions;
    const noSessions = typeof noSessionsRaw === 'string' ? noSessionsRaw.toLowerCase() === 'true' : false;

    const prismaClient = getPrisma();

    const deals = await prismaClient.deal.findMany({
      where: noSessions
        ? {
            sessions: { none: {} }
          }
        : {},
      include: {
        organization: true,
        notes: true,
        documents: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const payload = deals.map(mapDealRecord);

    return jsonResponse(200, {
      ok: true,
      requestId,
      count: payload.length,
      deals: payload
    });
  } catch (error) {
    console.error(`[${requestId}] deals list error`, error);
    return jsonResponse(500, {
      error: 'unexpected_error',
      message: error instanceof Error ? error.message : 'Error inesperado',
      requestId
    });
  }
};
