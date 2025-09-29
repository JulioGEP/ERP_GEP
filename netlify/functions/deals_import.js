const { Prisma } = require('@prisma/client');
const crypto = require('crypto');
const { COMMON_HEADERS, successResponse, errorResponse } = require('./_shared/response');
const { buildDealPayloadFromRecord } = require('./_shared/dealPayload');
const { getPrisma } = require('./_shared/prisma');

const PIPEDRIVE_API_TOKEN = (process.env.PIPEDRIVE_API_TOKEN || '').trim();
const PIPEDRIVE_HOSTS = ['https://api.pipedrive.com/v1', 'https://api-eu.pipedrive.com/v1'];

const DEAL_CUSTOM_FIELDS = {
  hours: '38f11c8876ecde803a027fbf3c9041fda2ae7eb7',
  direction: '8b2a7570f5ba8aa4754f061cd9dc92fd778376a7',
  sede: '676d6bd51e52999c582c01f67c99a35ed30bf6ae',
  caes: 'e1971bf3a21d48737b682bf8d864ddc5eb15a351',
  fundae: '245d60d4d18aec40ba888998ef92e5d00e494583',
  hotelNight: 'c3a6daf8eb5b4e59c3c07cda8e01f43439101269',
  pipeline: 'pipeline_id'
};

const ORGANIZATION_CUSTOM_FIELDS = {
  cif: '6d39d015a33921753410c1bab0b067ca93b8cf2c',
  phone: 'b4379db06dfbe0758d84c2c2dd45ef04fa093b6d'
};

function maskToken(url) {
  return url.replace(/(api_token=)[^&]+/gi, '$1***');
}

function decodeBody(event) {
  if (!event.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

function parseDealId(event) {
  const query = event.queryStringParameters || {};
  const queryDealId = query.dealId || query.federalNumber;
  if (queryDealId && String(queryDealId).trim()) {
    return String(queryDealId).trim();
  }

  if (!event.body) return null;
  const rawBody = decodeBody(event);
  if (!rawBody) return null;

  const contentType = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();

  if (contentType.includes('application/json')) {
    try {
      const data = JSON.parse(rawBody);
      const id = data?.dealId ?? data?.federalNumber;
      return id ? String(id).trim() : null;
    } catch {
      return null;
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(rawBody);
    const id = params.get('dealId') || params.get('federalNumber');
    return id ? String(id).trim() : null;
  }

  try {
    const data = JSON.parse(rawBody);
    const id = data?.dealId ?? data?.federalNumber;
    return id ? String(id).trim() : null;
  } catch {
    return null;
  }
}

async function callPipedrive(path, requestId, context) {
  const attempts = [];

  for (const host of PIPEDRIVE_HOSTS) {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${host}${path}${separator}api_token=${encodeURIComponent(PIPEDRIVE_API_TOKEN)}`;
    const start = Date.now();

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'follow'
      });
      const duration = Date.now() - start;
      const text = await response.text().catch(() => '');
      const contentType = response.headers.get('content-type');
      const maskedUrl = maskToken(url);
      const attempt = {
        host,
        status: response.status,
        statusText: response.statusText,
        durationMs: duration,
        url: maskedUrl,
        contentType,
        bodySnippet: (text || '').replace(/\s+/g, ' ').trim().slice(0, 800)
      };
      attempts.push(attempt);
      if (context?.label) {
        console.debug(`[${requestId}] Pipedrive ${context.label} via ${host} → ${response.status} (${duration}ms)`);
      }
      if (response.ok && typeof contentType === 'string' && contentType.toLowerCase().includes('application/json')) {
        try {
          const json = text ? JSON.parse(text) : null;
          return { ok: true, hostUsed: host, data: json, attempts };
        } catch (error) {
          attempt.statusText = `JSON parse error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    } catch (error) {
      attempts.push({
        host,
        status: 0,
        statusText: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
        url: maskToken(url),
        contentType: null,
        bodySnippet: ''
      });
    }
  }

  return { ok: false, attempts };
}

function extractField(entity, key) {
  if (!entity || typeof entity !== 'object') return null;
  const value = entity[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return value.value ?? null;
  }
  return value;
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseNumberLike(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPrimaryField(field) {
  if (!field) return null;
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    if (!field.length) return null;
    const primary = field.find((item) => item && item.primary);
    return (primary ?? field[0])?.value ?? null;
  }
  return null;
}

function parseQuantity(quantity) {
  if (quantity === null || quantity === undefined) return 0;
  if (typeof quantity === 'number') return Number.isFinite(quantity) ? quantity : 0;
  const parsed = parseInt(String(quantity), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

const fieldOptionsCache = new Map();

async function fetchFieldOptions(fieldKey, requestId) {
  const cached = fieldOptionsCache.get(fieldKey);
  if (cached) return cached;

  const response = await callPipedrive(`/dealFields/${encodeURIComponent(fieldKey)}`, requestId, {
    label: `dealFields/${fieldKey}`
  });

  let options = [];
  if (response.ok) {
    options = response.data?.data?.options || [];
  }

  if (!options.length) {
    const listResponse = await callPipedrive(`/dealFields`, requestId, { label: 'dealFields' });
    const all = listResponse.ok && Array.isArray(listResponse.data?.data) ? listResponse.data.data : [];
    const match = all.find((field) => field.key === fieldKey || String(field.id) === String(fieldKey));
    options = match?.options || [];
  }

  const map = new Map();
  for (const option of options) {
    if (!option) continue;
    map.set(option.id, option.label);
  }
  fieldOptionsCache.set(fieldKey, map);
  return map;
}

async function mapCustomFieldOption(fieldKey, rawValue, requestId) {
  if (rawValue === null || rawValue === undefined) return null;
  const options = await fetchFieldOptions(fieldKey, requestId);
  if (options.has(rawValue)) return options.get(rawValue);
  const numeric = Number(rawValue);
  if (!Number.isNaN(numeric) && options.has(numeric)) return options.get(numeric);
  const asString = String(rawValue);
  if (options.has(asString)) return options.get(asString);
  return asString;
}

function normalizeTrainingProducts(products) {
  return ensureArray(products).map((product) => ({
    product_id: product?.product_id ?? null,
    name: product?.name ?? null,
    code: product?.code ?? null,
    quantity: parseQuantity(product?.quantity)
  }));
}

function normalizeParticipants(rawParticipants) {
  const participants = [];
  for (const participant of ensureArray(rawParticipants)) {
    if (!participant) continue;
    const id = parseNumberLike(participant.person_id || participant.id);
    if (!id) continue;
    participants.push({
      id,
      first_name: participant.first_name ?? participant.person_name ?? null,
      last_name: participant.last_name ?? null,
      email: extractPrimaryField(participant.emails || participant.email),
      phone: extractPrimaryField(participant.phones || participant.phone),
      role: participant.role || participant.owner_name || participant.participant_type || null
    });
  }
  return participants;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  const requestId = crypto.randomUUID();

  try {
    if (event.httpMethod !== 'POST') {
      return errorResponse({
        statusCode: 405,
        errorCode: 'METHOD_NOT_ALLOWED',
        message: 'Método no permitido',
        requestId
      });
    }

    const dealIdInput = parseDealId(event);
    if (!dealIdInput) {
      return errorResponse({
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        message: 'dealId is required',
        requestId
      });
    }

    if (!PIPEDRIVE_API_TOKEN) {
      return errorResponse({
        statusCode: 500,
        errorCode: 'CONFIGURATION_ERROR',
        message: 'PIPEDRIVE_API_TOKEN no configurado',
        requestId
      });
    }

    console.debug(`[${requestId}] Import deal ${dealIdInput}`);

    const dealResponse = await callPipedrive(`/deals/${encodeURIComponent(dealIdInput)}?include_products=1`, requestId, {
      label: `deal ${dealIdInput}`
    });

    if (!dealResponse.ok) {
      console.error(`[${requestId}] Pipedrive deal fetch failed`, dealResponse.attempts);
      return errorResponse({
        statusCode: 502,
        errorCode: 'UPSTREAM_PIPEDRIVE_ERROR',
        message: 'No se pudo obtener el presupuesto en Pipedrive.',
        requestId,
        details: { attempts: dealResponse.attempts }
      });
    }

    const dealData = dealResponse.data?.data;
    if (!dealData || typeof dealData !== 'object') {
      return errorResponse({
        statusCode: 404,
        errorCode: 'DEAL_NOT_FOUND',
        message: 'No se ha encontrado el presupuesto solicitado en Pipedrive.',
        requestId
      });
    }

    const dealId = parseNumberLike(dealData.id);
    if (!dealId) {
      return errorResponse({
        statusCode: 500,
        errorCode: 'DEAL_ID_INVALID',
        message: 'Respuesta de Pipedrive inválida: falta id del presupuesto.',
        requestId
      });
    }

    const orgRaw = dealData.org_id;
    const orgId = orgRaw == null ? null : typeof orgRaw === 'object' ? parseNumberLike(orgRaw.value) : parseNumberLike(orgRaw);
    if (!orgId) {
      return errorResponse({
        statusCode: 400,
        errorCode: 'ORGANIZATION_MISSING',
        message: 'El presupuesto no tiene una organización asociada en Pipedrive.',
        requestId
      });
    }

    const personRaw = dealData.person_id;
    const personId = personRaw == null ? null : typeof personRaw === 'object' ? parseNumberLike(personRaw.value) : parseNumberLike(personRaw);

    const [organizationResponse, notesResponse, filesResponse, participantsResponse, primaryPersonResponse] = await Promise.all([
      callPipedrive(`/organizations/${orgId}`, requestId, { label: `organization ${orgId}` }),
      callPipedrive(`/deals/${dealId}/notes`, requestId, { label: `deal ${dealId} notes` }),
      callPipedrive(`/deals/${dealId}/files`, requestId, { label: `deal ${dealId} files` }),
      callPipedrive(`/deals/${dealId}/participants`, requestId, { label: `deal ${dealId} participants` }),
      personId ? callPipedrive(`/persons/${personId}`, requestId, { label: `person ${personId}` }) : Promise.resolve({ ok: false })
    ]);

    const organizationData = organizationResponse.ok ? organizationResponse.data?.data ?? null : null;
    const notes = Array.isArray(notesResponse.data?.data) ? notesResponse.data.data : [];
    const files = Array.isArray(filesResponse.data?.data) ? filesResponse.data.data : [];
    const rawParticipants = Array.isArray(participantsResponse.data?.data) ? participantsResponse.data.data : [];
    const participants = normalizeParticipants(rawParticipants);

    if (personId && !participants.some((participant) => participant.id === personId)) {
      const primaryPersonData = primaryPersonResponse.ok ? primaryPersonResponse.data?.data ?? null : null;
      if (primaryPersonData) {
        participants.unshift({
          id: personId,
          first_name: primaryPersonData.first_name ?? null,
          last_name: primaryPersonData.last_name ?? null,
          email: extractPrimaryField(primaryPersonData.email ?? null),
          phone: extractPrimaryField(primaryPersonData.phone ?? null),
          role: 'Responsable'
        });
      }
    }

    const products = ensureArray(dealData.products);
    const trainingProducts = products.filter((product) => {
      const code = (product?.code ?? '').toString().toLowerCase();
      return code.startsWith('form-');
    });
    const extraProducts = products.filter((product) => {
      const code = (product?.code ?? '').toString().toLowerCase();
      return !code.startsWith('form-');
    });

    const [sedeLabel, caesLabel, fundaeLabel, hotelLabel] = await Promise.all([
      mapCustomFieldOption(DEAL_CUSTOM_FIELDS.sede, extractField(dealData, DEAL_CUSTOM_FIELDS.sede), requestId),
      mapCustomFieldOption(DEAL_CUSTOM_FIELDS.caes, extractField(dealData, DEAL_CUSTOM_FIELDS.caes), requestId),
      mapCustomFieldOption(DEAL_CUSTOM_FIELDS.fundae, extractField(dealData, DEAL_CUSTOM_FIELDS.fundae), requestId),
      mapCustomFieldOption(DEAL_CUSTOM_FIELDS.hotelNight, extractField(dealData, DEAL_CUSTOM_FIELDS.hotelNight), requestId)
    ]);

    const trainingTypeRaw = extractField(dealData, DEAL_CUSTOM_FIELDS.pipeline);
    const trainingTypeStr = trainingTypeRaw == null ? null : String(trainingTypeRaw);

    const hoursRaw = extractField(dealData, DEAL_CUSTOM_FIELDS.hours);
    const hoursParsed = parseNumberLike(hoursRaw);

    const sessionsCount = trainingProducts.reduce((acc, product) => acc + parseQuantity(product.quantity), 0);

    const prismaClient = getPrisma();

    await prismaClient.$transaction(async (tx) => {
      await tx.organization.upsert({
        where: { id: orgId },
        create: {
          id: orgId,
          name: organizationData?.name ?? 'Organización sin nombre',
          cif: extractField(organizationData, ORGANIZATION_CUSTOM_FIELDS.cif),
          phone: extractField(organizationData, ORGANIZATION_CUSTOM_FIELDS.phone),
          address: organizationData?.address ?? null
        },
        update: {
          name: organizationData?.name ?? 'Organización sin nombre',
          cif: extractField(organizationData, ORGANIZATION_CUSTOM_FIELDS.cif),
          phone: extractField(organizationData, ORGANIZATION_CUSTOM_FIELDS.phone),
          address: organizationData?.address ?? null
        }
      });

      const uniqueParticipants = new Map();
      for (const participant of participants) {
        if (!participant?.id) continue;
        if (!uniqueParticipants.has(participant.id)) {
          uniqueParticipants.set(participant.id, participant);
        }
      }

      for (const participant of uniqueParticipants.values()) {
        await tx.person.upsert({
          where: { id: participant.id },
          create: {
            id: participant.id,
            organizationId: orgId,
            firstName: participant.first_name ?? null,
            lastName: participant.last_name ?? null,
            email: participant.email ?? null,
            phone: participant.phone ?? null
          },
          update: {
            organizationId: orgId,
            firstName: participant.first_name ?? null,
            lastName: participant.last_name ?? null,
            email: participant.email ?? null,
            phone: participant.phone ?? null
          }
        });
      }

      await tx.deal.upsert({
        where: { id: dealId },
        create: {
          id: dealId,
          organizationId: orgId,
          title: dealData.title || `Presupuesto ${dealId}`,
          trainingType: trainingTypeStr,
          hours: hoursParsed,
          direction: extractField(dealData, DEAL_CUSTOM_FIELDS.direction),
          sede: sedeLabel ?? (extractField(dealData, DEAL_CUSTOM_FIELDS.sede) != null
            ? String(extractField(dealData, DEAL_CUSTOM_FIELDS.sede))
            : null),
          caes: caesLabel ?? (extractField(dealData, DEAL_CUSTOM_FIELDS.caes) != null
            ? String(extractField(dealData, DEAL_CUSTOM_FIELDS.caes))
            : null),
          fundae: fundaeLabel ?? (extractField(dealData, DEAL_CUSTOM_FIELDS.fundae) != null
            ? String(extractField(dealData, DEAL_CUSTOM_FIELDS.fundae))
            : null),
          hotelNight: hotelLabel ?? (extractField(dealData, DEAL_CUSTOM_FIELDS.hotelNight) != null
            ? String(extractField(dealData, DEAL_CUSTOM_FIELDS.hotelNight))
            : null),
          alumnos: 0,
          training: normalizeTrainingProducts(trainingProducts),
          prodExtra: normalizeTrainingProducts(extraProducts),
          documentsNum: files.length,
          documentsIds: files.map((file) => file.id).join(',') || null,
          sessionsNum: sessionsCount,
          notesNum: notes.length
        },
        update: {
          organizationId: orgId,
          title: dealData.title || `Presupuesto ${dealId}`,
          trainingType: trainingTypeStr,
          hours: hoursParsed,
          direction: extractField(dealData, DEAL_CUSTOM_FIELDS.direction),
          sede: sedeLabel ?? (extractField(dealData, DEAL_CUSTOM_FIELDS.sede) != null
            ? String(extractField(dealData, DEAL_CUSTOM_FIELDS.sede))
            : null),
          caes: caesLabel ?? (extractField(dealData, DEAL_CUSTOM_FIELDS.caes) != null
            ? String(extractField(dealData, DEAL_CUSTOM_FIELDS.caes))
            : null),
          fundae: fundaeLabel ?? (extractField(dealData, DEAL_CUSTOM_FIELDS.fundae) != null
            ? String(extractField(dealData, DEAL_CUSTOM_FIELDS.fundae))
            : null),
          hotelNight: hotelLabel ?? (extractField(dealData, DEAL_CUSTOM_FIELDS.hotelNight) != null
            ? String(extractField(dealData, DEAL_CUSTOM_FIELDS.hotelNight))
            : null),
          training: normalizeTrainingProducts(trainingProducts),
          prodExtra: normalizeTrainingProducts(extraProducts),
          documentsNum: files.length,
          documentsIds: files.map((file) => file.id).join(',') || null,
          sessionsNum: sessionsCount,
          notesNum: notes.length
        }
      });

      await tx.dealParticipant.deleteMany({ where: { dealId } });
      if (uniqueParticipants.size) {
        const participantsData = Array.from(uniqueParticipants.values()).map((participant) => ({
          dealId,
          personId: participant.id,
          role: participant.role ?? null
        }));
        await tx.dealParticipant.createMany({ data: participantsData });
      }

      await tx.note.deleteMany({ where: { dealId } });
      if (notes.length) {
        await tx.note.createMany({
          data: notes.map((note) => ({
            id: note.id,
            dealId,
            comment: note.content ?? ''
          }))
        });
      }

      await tx.document.deleteMany({ where: { dealId } });
      if (files.length) {
        await tx.document.createMany({
          data: files.map((file) => ({
            id: file.id,
            dealId,
            title: file.name ?? `Documento ${file.id}`,
            url: file.file_url ?? null
          }))
        });
      }
    });

    const persisted = await prismaClient.deal.findUnique({
      where: { id: dealId },
      include: {
        organization: true,
        notes: true,
        documents: true,
        participants: { include: { person: true } }
      }
    });

    if (!persisted) {
      return errorResponse({
        statusCode: 500,
        errorCode: 'DEAL_PERSISTENCE_ERROR',
        message: 'El presupuesto se importó pero no se pudo recuperar de la base de datos.',
        requestId
      });
    }

    const payload = buildDealPayloadFromRecord(persisted);

    return successResponse({
      requestId,
      deal_id: String(dealId),
      deal: payload
    });
  } catch (error) {
    console.error(`[${requestId}] deals_import error`, error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(', ')
        : error.meta?.target ?? undefined;

      let statusCode = 500;
      let errorCode = `PRISMA_${error.code}`;
      let message = error.message;

      if (error.code === 'P2002') {
        statusCode = 409;
        errorCode = 'PRISMA_CONSTRAINT_VIOLATION';
        message = `Unique constraint failed${target ? ` on ${target}` : ''}`;
      } else if (error.code === 'P2003') {
        statusCode = 409;
        errorCode = 'PRISMA_FOREIGN_KEY_VIOLATION';
        message = `Foreign key constraint failed${target ? ` on ${target}` : ''}`;
      } else if (error.code === 'P2025') {
        statusCode = 404;
        errorCode = 'PRISMA_RECORD_NOT_FOUND';
        message = 'Registro solicitado no encontrado durante la importación.';
      }

      return errorResponse({ statusCode, errorCode, message, requestId });
    }

    return errorResponse({
      statusCode: 500,
      errorCode: 'UNEXPECTED_ERROR',
      message: error instanceof Error ? error.message : 'Error inesperado',
      requestId
    });
  }
};
