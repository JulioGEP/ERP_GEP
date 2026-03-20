import { createHttpHandler } from './_shared/http';
import {
  findFieldDef,
  getDeal,
  getDealFields,
  getDealProducts,
  getOrganization,
  getPerson,
  optionLabelOf,
} from './_shared/pipedrive';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

const HOLDED_CONTACTS_ENDPOINT = 'https://api.holded.com/api/invoicing/v1/contacts';
const HOLDED_ESTIMATES_ENDPOINT = 'https://api.holded.com/api/invoicing/v1/documents/estimate';
const PIPEDRIVE_HOLDED_FIELD_KEY = '4118257ffc3bad107769f69d05e5bd1d7415cadd';
const DEAL_SERVICE_TYPE_FIELD_KEYS = [
  'ce2c299bd19c48d40297cd7b204780585ab2a5f0',
  '1d78d202448ee549a86e0881ec06f3ff7842c5ea',
] as const;
const DEAL_ROUTE_SITE_FIELD_KEYS = [
  '21e21e35f209ba485a2e8a209e35eda396875d11',
  '676d6bd51e52999c582c01f67c99a35ed30bf6ae',
] as const;
const DEAL_CONTACT_CODE_FIELD_KEY = '3f67c7125b2291a31a63dc01a778b6fd1ef41b3d';
const DEAL_PO_FIELD_KEY = '9cf8ccb7ef293494974f98ddbc72ec726486310e';
const DEAL_PAYMENT_DAY_FIELD_KEY = '2bbffae2c28ba11855fc1272ad70a31967bdb97c';
const DEAL_PAYMENT_FORM_FIELD_KEY = 'fccd44232ff07afb4014d6d32f8e94709afb24fe';
const DEAL_TRAINING_SITE_FIELD_KEY = '676d6bd51e52999c582c01f67c99a35ed30bf6ae';
const DEAL_TRAINING_DATE_FIELD_KEY = '98f072a788090ac2ae52017daaf9618c3a189033';
const DEAL_INVOICE_EMAIL_FIELD_KEY = '8b0652b56fd17d4547149f1ae26b1b74b527eaf0';
const DEAL_PIPELINE_ID = '3';
const DEAL_WON_STATUS = 'won';
const DEAL_STAGE_NAME = 'Formación Ganada';
const INDIVIDUAL_PAYMENT_METHOD_ID = '65845b74c9a83d8ce30d8b72';
const HOLDED_PAYMENT_METHOD_BY_PIPEDRIVE_FORM = [
  {
    pipedriveValue: 'TRF CAIXABANK ES42 2100 0297 0002 0048 7560',
    holdedId: '65845b74c9a83d8ce30d8b72',
  },
  {
    pipedriveValue: 'TRF BSANTANDER ES25 0049 2558 5127 1454 6449',
    holdedId: '65a4ea68deb80f770a03a605',
  },
  {
    pipedriveValue: 'CXB TPV WEB',
    holdedId: '6759892555d547e2c90aa0ae',
  },
  {
    pipedriveValue: 'TRF BSABADELL ES77 0081 0404 8500 0126 3131',
    holdedId: '65aa2fa043e2b80e3401df97',
  },
] as const;

type RouteKey = 'andalucia' | 'madrid' | 'sabadell';
type BudgetKind = 'empresa' | 'individual';

type RouteConfig = {
  salesChannelId: string;
  tags: string[];
};

const COMPANY_ROUTE_CONFIG: Record<RouteKey, RouteConfig> = {
  andalucia: {
    salesChannelId: '65ba50c3f957de633000d5a0',
    tags: ['abierta', 'andalucianv', 'formacion'],
  },
  madrid: {
    salesChannelId: '65ba4fb510f428f465015381',
    tags: ['abierta', 'madridnv', 'formacion'],
  },
  sabadell: {
    salesChannelId: '65ba4be92a1064ab340301e2',
    tags: ['abierta', 'sabadellnv', 'formacion'],
  },
};

const INDIVIDUAL_ROUTE_CONFIG: Record<RouteKey, RouteConfig> = {
  andalucia: {
    salesChannelId: '65ba50c3f957de633000d5a0',
    tags: ['abierta', 'formacion', 'cadiznv'],
  },
  madrid: {
    salesChannelId: '65ba4fb510f428f465015381',
    tags: ['abierta', 'formacion', 'madridnv'],
  },
  sabadell: {
    salesChannelId: '65ba4be92a1064ab340301e2',
    tags: ['abierta', 'formacion', 'sabadellnv'],
  },
};

type HoldedContact = {
  id?: string | number;
  code?: string | null;
  name?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeText(item);
      if (normalized) return normalized;
    }
    return null;
  }
  if (typeof value === 'object') {
    const candidates = [
      (value as any).label,
      (value as any).name,
      (value as any).value,
      (value as any).formatted_address,
      (value as any).email,
      (value as any).phone,
      (value as any).id,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeText(candidate);
      if (normalized) return normalized;
    }
  }
  return null;
}

function normalizeComparison(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function htmlToPlainText(value: unknown): string {
  const text = normalizeText(value) ?? '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>\s*<div>/gi, '\n')
    .replace(/<div>/gi, '')
    .replace(/<\/div>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  const normalized = normalizeText(value);
  if (!normalized) return fallback;
  const parsed = Number(normalized.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickPrimaryValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const primary = value.find((item) => item && typeof item === 'object' && (item as any).primary);
    return normalizeText(primary ?? value[0]);
  }
  return normalizeText(value);
}

function resolveFieldLabel(deal: Record<string, any>, fieldDefs: any[], fieldKeys: readonly string[]): string | null {
  for (const fieldKey of fieldKeys) {
    const fieldDef = findFieldDef(fieldDefs, fieldKey);
    const rawValue = deal?.[fieldKey];
    const labeled = fieldDef ? optionLabelOf(fieldDef, rawValue) : null;
    const normalized = normalizeText(labeled ?? rawValue);
    if (normalized) return normalized;
  }
  return null;
}

function resolveAddress(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const formatted = normalizeText((value as any).formatted_address);
    if (formatted) return formatted;
  }
  return normalizeText(value);
}

function resolveRouteKey(routeLabel: string | null): RouteKey | null {
  const normalized = normalizeComparison(routeLabel);
  if (!normalized) return null;
  if (normalized.includes('andaluc')) return 'andalucia';
  if (normalized.includes('madrid')) return 'madrid';
  if (normalized.includes('sabadell')) return 'sabadell';
  return null;
}

function resolveBudgetKind(serviceTypeLabel: string | null): BudgetKind | null {
  const normalized = normalizeComparison(serviceTypeLabel);
  if (!normalized) return null;
  if (normalized.includes('empresa')) return 'empresa';
  if (normalized.includes('individual') || normalized.includes('autonomo')) return 'individual';
  return null;
}

function getRouteConfig(kind: BudgetKind, routeKey: RouteKey): RouteConfig {
  return kind === 'empresa' ? COMPANY_ROUTE_CONFIG[routeKey] : INDIVIDUAL_ROUTE_CONFIG[routeKey];
}

function resolveHoldedPaymentMethodId(paymentForm: string | null): string | null {
  const normalizedPaymentForm = normalizeComparison(paymentForm);
  if (!normalizedPaymentForm) return null;

  const exactMatch = HOLDED_PAYMENT_METHOD_BY_PIPEDRIVE_FORM.find(
    (entry) => normalizeComparison(entry.pipedriveValue) === normalizedPaymentForm,
  );
  if (exactMatch) return exactMatch.holdedId;

  const partialMatch = HOLDED_PAYMENT_METHOD_BY_PIPEDRIVE_FORM.find((entry) =>
    normalizedPaymentForm.includes(normalizeComparison(entry.pipedriveValue)),
  );
  return partialMatch?.holdedId ?? null;
}

function buildBudgetNotes(params: {
  po: string | null;
  paymentDay: string | null;
  paymentForm: string | null;
  invoiceEmail: string | null;
  trainingSite: string | null;
  trainingDate: string | null;
  comercial: string | null;
}) {
  return [
    'Administración',
    `Orden de compra: ${params.po ?? ''}`,
    `Día de pago: ${params.paymentDay ?? ''}`,
    `Forma de Pago: ${params.paymentForm ?? ''}`,
    `Correo de Facturación: ${params.invoiceEmail ?? ''}`,
    '-----------',
    'Planificación',
    `Sede de la formación: ${params.trainingSite ?? ''}`,
    `Fecha Formación: ${params.trainingDate ?? ''}`,
    '-----------',
    `Comercial: ${params.comercial ?? ''}`,
  ].join('\n');
}

function buildItems(products: any[]): Array<Record<string, unknown>> {
  return (Array.isArray(products) ? products : []).map((product) => {
    const rawSku = normalizeText(product?.product_id ?? product?.id ?? product?.product?.id) ?? '';
    const name = normalizeText(product?.name ?? product?.product?.name) ?? 'Línea sin nombre';
    const description = htmlToPlainText(product?.comments ?? product?.description ?? '');
    const subtotal = parseNumber(product?.item_price ?? product?.price, 0);
    const tax = parseNumber(
      product?.product_tax ?? product?.tax ?? product?.product?.tax ?? product?.product?.tax_percentage,
      0,
    );
    const units = parseNumber(product?.quantity, 1) || 1;
    const discount = parseNumber(product?.discount ?? product?.discount_percentage, 0);

    return {
      sku: rawSku ? `SKU${rawSku}` : '',
      desc: description,
      subtotal,
      tax,
      units,
      discount,
      name,
    };
  });
}

async function holdedRequest<T = any>(
  apiKey: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      key: apiKey,
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text().catch(() => '');
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!response.ok) {
    const serialized = typeof json === 'string' ? json : JSON.stringify(json ?? {});
    throw new Error(`Holded respondió ${response.status}: ${serialized}`);
  }

  return json as T;
}

async function findOrCreateHoldedContact(params: {
  apiKey: string;
  code: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  currency: string | null;
  individual: boolean;
}) {
  const searchTerms = [params.code, params.name].filter((value): value is string => Boolean(value));
  for (const searchTerm of searchTerms) {
    const url = `${HOLDED_CONTACTS_ENDPOINT}?search=${encodeURIComponent(searchTerm)}`;
    const results = await holdedRequest<HoldedContact[]>(params.apiKey, url, { method: 'GET' }).catch(() => []);
    const normalizedSearch = normalizeComparison(searchTerm);
    const matched = Array.isArray(results)
      ? results.find((contact) => {
          const codeMatches = normalizeComparison(contact?.code) === normalizedSearch;
          const nameMatches = normalizeComparison(contact?.name) === normalizeComparison(params.name);
          return codeMatches || nameMatches;
        })
      : null;

    if (matched?.id != null) {
      return {
        id: String(matched.id),
        code: normalizeText(matched.code) ?? params.code ?? '',
        created: false,
      };
    }
  }

  const payload = {
    code: params.code ?? undefined,
    type: 'client',
    isperson: 'Company',
    phone: params.phone ?? undefined,
    address: params.address ?? undefined,
    tags: params.individual ? ['abiertaindividual'] : [],
    name: params.name,
    currency: params.currency ?? undefined,
  };

  const created = await holdedRequest<any>(params.apiKey, HOLDED_CONTACTS_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const createdId = normalizeText(created?.id ?? created?._id);
  if (!createdId) {
    throw new Error('Holded no devolvió el identificador del contacto creado.');
  }

  return {
    id: createdId,
    code: normalizeText(created?.code) ?? params.code ?? '',
    created: true,
  };
}

async function updatePipedriveHoldedField(dealId: string, holdedDocumentId: string) {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    throw new Error('Falta PIPEDRIVE_API_TOKEN en variables de entorno');
  }

  const baseUrl = process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
  const url = `${baseUrl.replace(/\/$/, '')}/deals/${encodeURIComponent(dealId)}?api_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ [PIPEDRIVE_HOLDED_FIELD_KEY]: holdedDocumentId }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`No se pudo actualizar Pipedrive (${response.status}): ${text}`);
  }
}

export const handler = createHttpHandler<{ dealId?: string }>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  const dealId = normalizeText(request.body?.dealId);
  if (!dealId) {
    return errorResponse('VALIDATION_ERROR', 'Falta dealId para enviar el presupuesto a Holded.', 400);
  }

  const holdedApiKey = process.env.API_HOLDED_KEY;
  if (!holdedApiKey) {
    return errorResponse('CONFIG_ERROR', 'API_HOLDED_KEY no configurada.', 500);
  }

  try {
    const [deal, fieldDefs, products] = await Promise.all([
      getDeal(dealId),
      getDealFields(),
      getDealProducts(dealId),
    ]);

    if (!deal) {
      return errorResponse('NOT_FOUND', 'No se encontró el deal en Pipedrive.', 404);
    }

    const pipelineId = normalizeText(deal?.pipeline_id);
    const status = normalizeComparison(deal?.status);
    const stageName = normalizeText(deal?.stage_name ?? deal?.stage?.name);
    const existingHoldedId = normalizeText(deal?.[PIPEDRIVE_HOLDED_FIELD_KEY]);

    if (existingHoldedId) {
      return errorResponse('ALREADY_SYNCED', 'El presupuesto ya tiene un ID de Holded asociado.', 409);
    }

    if (pipelineId && pipelineId !== DEAL_PIPELINE_ID) {
      return errorResponse('INVALID_PIPELINE', 'El deal no pertenece al pipeline de formación abierta.', 400);
    }

    if (status && status !== normalizeComparison(DEAL_WON_STATUS)) {
      return errorResponse('INVALID_STATUS', 'Solo se pueden enviar a Holded deals ganados.', 400);
    }

    if (stageName && normalizeComparison(stageName) !== normalizeComparison(DEAL_STAGE_NAME)) {
      return errorResponse('INVALID_STAGE', 'El deal debe estar en la fase Formación Ganada.', 400);
    }

    const serviceTypeLabel = resolveFieldLabel(deal, fieldDefs, DEAL_SERVICE_TYPE_FIELD_KEYS);
    const budgetKind = resolveBudgetKind(serviceTypeLabel);
    if (!budgetKind) {
      return errorResponse('UNSUPPORTED_SERVICE_TYPE', 'El tipo de servicio no está contemplado en la automatización.', 400);
    }

    const routeLabel = resolveFieldLabel(deal, fieldDefs, DEAL_ROUTE_SITE_FIELD_KEYS);
    const routeKey = resolveRouteKey(routeLabel);
    if (!routeKey) {
      return errorResponse('UNSUPPORTED_SITE', 'La sede del presupuesto no está contemplada en la automatización.', 400);
    }

    const [organization, person] = await Promise.all([
      deal?.org_id ? getOrganization((deal.org_id as any)?.value ?? deal.org_id) : null,
      deal?.person_id ? getPerson((deal.person_id as any)?.value ?? deal.person_id) : null,
    ]);

    const organizationName = normalizeText(organization?.name) ?? normalizeText((deal.org_id as any)?.name);
    const personName = [normalizeText(person?.first_name ?? person?.name), normalizeText(person?.last_name)]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .trim();
    const contactName = organizationName ?? personName ?? `Deal ${dealId}`;
    const routeConfig = getRouteConfig(budgetKind, routeKey);

    const contactCode = normalizeText(deal?.[DEAL_CONTACT_CODE_FIELD_KEY]);
    const contactPhone = pickPrimaryValue(person?.phone ?? (deal.person_id as any)?.phone);
    const contactAddress = resolveAddress(organization?.address ?? (deal.org_id as any)?.address);
    const currency = normalizeText(deal?.currency);

    const holdedContact = await findOrCreateHoldedContact({
      apiKey: holdedApiKey,
      code: contactCode,
      name: contactName,
      phone: contactPhone,
      address: contactAddress,
      currency,
      individual: budgetKind === 'individual',
    });

    const paymentFormLabel = resolveFieldLabel(deal, fieldDefs, [DEAL_PAYMENT_FORM_FIELD_KEY])
      ?? normalizeText(deal?.[DEAL_PAYMENT_FORM_FIELD_KEY]);
    const holdedPaymentMethodId = resolveHoldedPaymentMethodId(paymentFormLabel);

    const notes = buildBudgetNotes({
      po: normalizeText(deal?.[DEAL_PO_FIELD_KEY]),
      paymentDay: normalizeText(deal?.[DEAL_PAYMENT_DAY_FIELD_KEY]),
      paymentForm: paymentFormLabel,
      invoiceEmail: normalizeText(deal?.[DEAL_INVOICE_EMAIL_FIELD_KEY]),
      trainingSite: resolveFieldLabel(deal, fieldDefs, [DEAL_TRAINING_SITE_FIELD_KEY]),
      trainingDate: normalizeText(deal?.[DEAL_TRAINING_DATE_FIELD_KEY]),
      comercial: normalizeText(deal?.owner_name ?? deal?.owner_id?.name),
    });

    const items = buildItems(Array.isArray(products) ? products : []);
    if (!items.length) {
      return errorResponse('NO_PRODUCTS', 'El deal no tiene líneas de producto para enviar a Holded.', 400);
    }

    const quotePayload: Record<string, unknown> = {
      date: normalizeText(deal?.update_time ?? deal?.add_time),
      contactCode: holdedContact.code || undefined,
      contactId: holdedContact.id,
      invoiceNum: `PRVGR25-${dealId}`,
      salesChannelId: routeConfig.salesChannelId,
      tags: routeConfig.tags,
      notes,
      items,
    };

    if (holdedPaymentMethodId) {
      quotePayload.paymentMethod = holdedPaymentMethodId;
    } else if (budgetKind === 'individual') {
      quotePayload.paymentMethod = INDIVIDUAL_PAYMENT_METHOD_ID;
    }

    const createdQuote = await holdedRequest<any>(holdedApiKey, HOLDED_ESTIMATES_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(quotePayload),
    });

    const documentId = normalizeText(createdQuote?.id);
    if (!documentId) {
      throw new Error('Holded no devolvió el identificador del presupuesto creado.');
    }

    await Promise.all([
      updatePipedriveHoldedField(dealId, documentId),
      getPrisma().deals.updateMany({
        where: { deal_id: dealId },
        data: { presu_holded: documentId },
      }),
    ]);

    return successResponse({
      documentId,
      holdedContactId: holdedContact.id,
      holdedContactCode: holdedContact.code,
      budgetKind,
      routeKey,
      simulated: true,
    });
  } catch (error) {
    console.error('[budgets-send-to-holded] sync failed', { dealId, error });
    const message = error instanceof Error ? error.message : 'No se pudo enviar el presupuesto a Holded.';
    return errorResponse('HOLDED_SYNC_ERROR', message, 500);
  }
});
