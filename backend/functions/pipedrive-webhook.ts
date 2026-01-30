import { Prisma } from '@prisma/client';
import type { Handler, HandlerResponse } from '@netlify/functions';
import { extractProductCatalogAttributes, getPerson, getProduct } from './_shared/pipedrive';
import { COMMON_HEADERS } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { deleteDealFromDatabase, importDealFromPipedrive } from './deals';
import { buildMailchimpPersonInput } from './_shared/pipedrive-mailchimp';

const EXPECTED_TOKEN = process.env.PIPEDRIVE_WEBHOOK_TOKEN;

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    normalized[key.toLowerCase()] = Array.isArray(value)
      ? value.filter(Boolean).join(', ')
      : String(value);
  }
  return normalized;
}

function decodeBody(event: Parameters<Handler>[0]):
  | { rawBody: string | null }
  | { error: HandlerResponse } {
  const raw = event.body;
  if (raw === undefined || raw === null) {
    return { rawBody: null };
  }

  const value = typeof raw === 'string' ? raw : String(raw);
  if (!event.isBase64Encoded) {
    return { rawBody: value };
  }

  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return { rawBody: decoded };
  } catch (error) {
    console.error('[pipedrive-webhook] Failed to decode base64 body', error);
    return {
      error: {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          ok: false,
          error_code: 'INVALID_BODY',
          message: 'Cuerpo codificado inválido',
        }),
      },
    };
  }
}

function parseJsonBody(rawBody: string | null):
  | { body: any }
  | { error: HandlerResponse } {
  if (rawBody === null) {
    return { body: {} };
  }

  const trimmed = rawBody.trim();
  if (!trimmed.length) {
    return { body: {} };
  }

  try {
    return { body: JSON.parse(trimmed) };
  } catch (error) {
    console.error('[pipedrive-webhook] Invalid JSON body received', error);
    return {
      error: {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          ok: false,
          error_code: 'INVALID_JSON',
          message: 'El cuerpo debe ser JSON válido',
        }),
      },
    };
  }
}

function normalizeNullableInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveToken(
  headers: Record<string, string>,
  body: Record<string, unknown>,
): string | null {
  const headerCandidates = [
    headers['x-pipedrive-webhook-token'],
    headers['x-pipedrive-token'],
    headers['x-pipedrive-signature'],
  ];

  for (const candidate of headerCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length) {
      return candidate.trim();
    }
  }

  const bodyToken = (() => {
    const direct = body?.['webhook_token'];
    if (typeof direct === 'string' && direct.trim().length) return direct.trim();

    const metaToken =
      typeof body.meta === 'object' && body.meta !== null
        ? (body.meta as any).webhook_token
        : null;
    if (typeof metaToken === 'string' && metaToken.trim().length)
      return metaToken.trim();

    return null;
  })();

  return bodyToken;
}

function filterHeaders(headers: Record<string, string>): Record<string, string> | null {
  const allowedPrefixes = ['x-pipedrive-'];
  const allowedKeys = new Set(['content-type']);

  const entries = Object.entries(headers).filter(([key]) =>
    allowedKeys.has(key) || allowedPrefixes.some((prefix) => key.startsWith(prefix)),
  );

  if (!entries.length) return null;

  return Object.fromEntries(entries);
}

function normalizeDealId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str.length) return null;

  const asNumber = Number.parseInt(str, 10);
  if (Number.isFinite(asNumber)) return String(asNumber);
  return str;
}

function resolveDealId(body: Record<string, unknown>): string | null {
  const data = body?.['data'] as Record<string, unknown> | undefined;
  const meta = body?.['meta'] as Record<string, unknown> | undefined;

  const candidates = [
    data?.['id'],
    data && typeof data === 'object' ? (data as any).current?.id : null,
    data && typeof data === 'object' ? (data as any).previous?.id : null,
    meta?.['id'],
  ];

  for (const candidate of candidates) {
    const normalized = normalizeDealId(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function resolveDealStatus(body: Record<string, unknown>): string | null {
  const data = body?.['data'] as Record<string, unknown> | undefined;
  const candidates = [
    data?.['status'],
    data && typeof data === 'object' ? (data as any).current?.status : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length) {
      return candidate.trim();
    }
  }

  return null;
}

function resolveAction(body: Record<string, unknown>): string | null {
  const meta = body?.['meta'] as Record<string, unknown> | undefined;
  const candidates = [body?.['action'], meta?.['action']];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length) {
      return candidate.trim().toLowerCase();
    }
  }

  return null;
}

function resolveEntity(body: Record<string, unknown>): string | null {
  const meta = body?.['meta'] as Record<string, unknown> | undefined;
  const candidates = [body?.['entity'], meta?.['object'], meta?.['entity']];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length) {
      return candidate.trim().toLowerCase();
    }
  }

  return null;
}

function resolveEntityId(body: Record<string, unknown>): string | null {
  const meta = body?.['meta'] as Record<string, unknown> | undefined;
  const candidates = [body?.['entity_id'], meta?.['entity_id'], meta?.['id']];

  for (const candidate of candidates) {
    const normalized = normalizeDealId(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function isDealWonStatus(status: unknown): boolean {
  return typeof status === 'string' && status.trim().toLowerCase() === 'won';
}

function buildErrorResponse(statusCode: number, code: string, message: string) {
  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: JSON.stringify({ ok: false, error_code: code, message }),
  };
}

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizePipelineLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const label = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return label.length ? label : null;
}

function isFormacionAbiertaPipeline(value: unknown): boolean {
  return normalizePipelineLabel(value) === 'formacion abierta';
}

function normalizeCategory(value: string | null | undefined) {
  if (!value) return null;
  return value.trim();
}

async function updateProductFromPipedrive(prisma: ReturnType<typeof getPrisma>, productId: string) {
  const existingProduct = await prisma.products.findUnique({
    where: { id_pipe: productId },
  });

  const pdProduct = await getProduct(productId);
  if (!pdProduct) return { updated: false } as const;

  const attributes = await extractProductCatalogAttributes(pdProduct);
  const categoryLabel = normalizeCategory(attributes.category ?? normalizeText(pdProduct?.category));
  const typeLabel = normalizeText(attributes.type);

  const priceValue = Number((pdProduct as any)?.price ?? (pdProduct as any)?.prices?.[0]?.price);
  const price = Number.isFinite(priceValue) ? priceValue : null;
  const data = {
    name: normalizeText(pdProduct?.name),
    code: normalizeText(attributes.code ?? pdProduct?.code),
    category: categoryLabel,
    type: typeLabel,
    price: price != null ? new Prisma.Decimal(price) : null,
    active: (pdProduct as any)?.selectable === undefined ? true : Boolean((pdProduct as any).selectable),
    updated_at: new Date(),
  };

  await prisma.products.upsert({
    where: { id_pipe: productId },
    update: data,
    create: {
      id_pipe: productId,
      ...data,
    },
  });

  return { updated: true, created: !existingProduct } as const;
}

async function deleteProductFromDatabase(prisma: ReturnType<typeof getPrisma>, productId: string) {
  const deletion = await prisma.products.deleteMany({
    where: { id_pipe: productId },
  });

  return { deleted: deletion.count > 0 } as const;
}

async function refreshFormacionAbiertaDeal(
  prisma: ReturnType<typeof getPrisma>,
  dealId: string,
): Promise<boolean> {
  const stored = await prisma.deals.findUnique({
    where: { deal_id: dealId },
    select: { pipeline_label: true, pipeline_id: true },
  });
  const pipeline = stored?.pipeline_label ?? stored?.pipeline_id ?? null;

  if (!isFormacionAbiertaPipeline(pipeline)) {
    return false;
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));
  await importDealFromPipedrive(dealId);
  return true;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return buildErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Solo se admite POST');
  }

  const normalizedHeaders = normalizeHeaders(event.headers);
  const decoded = decodeBody(event);
  if ('error' in decoded) return decoded.error;

  const parsed = parseJsonBody(decoded.rawBody);
  if ('error' in parsed) return parsed.error;

  const body = parsed.body as Record<string, unknown>;
  const resolvedToken = resolveToken(normalizedHeaders, body);

  if (EXPECTED_TOKEN && resolvedToken !== EXPECTED_TOKEN) {
    return buildErrorResponse(401, 'INVALID_TOKEN', 'Token de webhook no válido');
  }

  const prisma = getPrisma();
  let processedDealId: string | null = null;
  let processedAction:
    | 'created'
    | 'updated'
    | 'deleted'
    | 'product_deleted'
    | 'product_updated'
    | 'product_created'
    | 'person_created'
    | 'person_updated'
    | 'skipped' = 'skipped';
  const filteredHeaders = filterHeaders(normalizedHeaders);

  await prisma.pipedrive_webhook_events.create({
    data: {
      event: typeof body.event === 'string' ? body.event : null,
      event_action:
        typeof body.meta === 'object' && body.meta !== null &&
        typeof (body.meta as any).action === 'string'
          ? (body.meta as any).action
          : null,
      event_object:
        typeof body.meta === 'object' && body.meta !== null &&
        typeof (body.meta as any).object === 'string'
          ? (body.meta as any).object
          : null,
      company_id:
        typeof body.meta === 'object' && body.meta !== null
          ? normalizeNullableInt((body.meta as any).company_id)
          : null,
      object_id:
        typeof body.meta === 'object' && body.meta !== null
          ? normalizeNullableInt((body.meta as any).id)
          : null,
      retry: normalizeNullableInt(body.retry),
      webhook_token: resolvedToken,
      headers: filteredHeaders ?? Prisma.JsonNull,
      payload: (body as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    },
  });

  try {
    const action = resolveAction(body);
    const dealId = resolveDealId(body);
    const status = resolveDealStatus(body);
    const entity = resolveEntity(body);

    if (entity === 'product' && (action === 'change' || action === 'create')) {
      const productId = resolveEntityId(body) ?? resolveDealId(body);
      if (productId) {
        const { updated, created } = await updateProductFromPipedrive(prisma, productId);
        if (updated) {
          processedDealId = productId;
          processedAction = created ? 'product_created' : 'product_updated';
        }
      }
    }

    if (entity === 'person' && (action === 'create' || action === 'change' || action === 'update')) {
      const personId = resolveEntityId(body) ?? normalizeDealId((body as any)?.data?.id);
      if (personId) {
        const person = await getPerson(personId);
        const mapped = await buildMailchimpPersonInput(person, new Map());
        if (mapped) {
          const { person_id, ...payload } = mapped;
          const now = new Date();
          await prisma.pipedrive_mailchimp_persons.upsert({
            where: { person_id },
            update: { ...payload, updated_at: now },
            create: { person_id, ...payload, created_at: now, updated_at: now },
          });
          processedDealId = person_id;
          processedAction = action === 'create' ? 'person_created' : 'person_updated';
        }
      }
    }

    if (action === 'delete' && entity === 'product') {
      const productId = resolveEntityId(body);
      if (productId) {
        const deletionResult = await deleteProductFromDatabase(prisma, productId);
        if (deletionResult.deleted) {
          processedDealId = productId;
          processedAction = 'product_deleted';
        }
      }
    } else if (action === 'delete') {
      const entityId = resolveEntityId(body) ?? dealId;
      if (entityId) {
        const deletionResult = await deleteDealFromDatabase(prisma, entityId);
        if (deletionResult.deleted) {
          processedDealId = entityId;
          processedAction = 'deleted';
        }
      }
    } else if (dealId && isDealWonStatus(status)) {
      const existedBefore = await prisma.deals.findUnique({
        where: { deal_id: dealId },
        select: { deal_id: true },
      });

      await importDealFromPipedrive(dealId);
      await refreshFormacionAbiertaDeal(prisma, dealId);

      processedDealId = dealId;
      processedAction = existedBefore ? 'updated' : 'created';
    }
  } catch (processError) {
    console.error('[pipedrive-webhook] Failed processing deal webhook', {
      error:
        processError instanceof Error
          ? { message: processError.message, stack: processError.stack }
          : processError,
    });
    return buildErrorResponse(502, 'DEAL_PROCESSING_FAILED', 'No se pudo procesar el webhook');
  }

  return {
    statusCode: 200,
    headers: COMMON_HEADERS,
    body: JSON.stringify({ ok: true, processed: processedDealId, action: processedAction }),
  };
};
