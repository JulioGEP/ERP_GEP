import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { getDealProducts, getDealNotes } from './_shared/pipedrive';
import { importDealFromPipedrive } from './deals';

type JsonObject = Record<string, unknown>;

type HoldedInvoiceProduct = {
  sku: string | null;
  name: string | null;
  description: string | null;
  price: number | null;
  quantity: number;
  taxPercentage: number | null;
  discountPercentage: number | null;
};

type NormalizedHoldedInvoice = {
  invoiceId: string | null;
  invoiceNumber: string | null;
  contactName: string;
  contactCode: string | null;
  billAddress: string | null;
  invoiceDate: string | null;
  notes: string | null;
  docType: string | null;
  customFieldsPresent: boolean;
  sourceDocType: string | null;
  products: HoldedInvoiceProduct[];
  raw: JsonObject;
};

type SyncResult = {
  organizationId: string;
  dealId: string;
  title: string;
  createdOrganization: boolean;
  createdDeal: boolean;
  productsProcessed: number;
  productsSkipped: number;
  warnings: string[];
};

const DEFAULT_OWNER_ID = parseIntegerEnv(process.env.HOLDED_PIPE_DEFAULT_OWNER_ID, 13444807);
const DEFAULT_VISIBLE_TO = parseIntegerEnv(process.env.HOLDED_PIPE_VISIBLE_TO, 7);
const DEFAULT_PIPELINE_ID = parseIntegerEnv(process.env.HOLDED_PIPE_PIPELINE_ID, 1);
const DEFAULT_OPEN_STAGE_ID = parseIntegerEnv(process.env.HOLDED_PIPE_OPEN_STAGE_ID, 12);
const DEFAULT_WON_STAGE_ID = parseIntegerEnv(process.env.HOLDED_PIPE_WON_STAGE_ID, 12);

const ORG_CIF_FIELD_KEY = process.env.HOLDED_PIPE_ORG_CIF_FIELD_KEY || '6d39d015a33921753410c1bab0b067ca93b8cf2c';
const ORG_EMAIL_FIELD_KEY = process.env.HOLDED_PIPE_ORG_EMAIL_FIELD_KEY || '304ab03c5ac339ef085f0f6cfe4cb1c89ed6aa9f';
const ORG_ACQUISITION_CHANNEL_FIELD_KEY = process.env.HOLDED_PIPE_ORG_ACQUISITION_CHANNEL_FIELD_KEY || '940ca2a3d3462e024ccf9b38a26e4a4cb070e7c8';
const ORG_COMPANY_TYPE_FIELD_KEY = process.env.HOLDED_PIPE_ORG_COMPANY_TYPE_FIELD_KEY || '8a65e9b780cbab3f08ccc8babe92a290fb79f216';
const ORG_SOURCE_FIELD_KEY = process.env.HOLDED_PIPE_ORG_SOURCE_FIELD_KEY || '10c4bb275abbe4b23ec9cb296b226aa6f7130a3f';

const DEAL_CONTACT_CODE_FIELD_KEY = process.env.HOLDED_PIPE_DEAL_CONTACT_CODE_FIELD_KEY || '3f67c7125b2291a31a63dc01a778b6fd1ef41b3d';
const DEAL_ADDRESS_FIELD_KEY = process.env.HOLDED_PIPE_DEAL_ADDRESS_FIELD_KEY || '8b2a7570f5ba8aa4754f061cd9dc92fd778376a7';
const DEAL_STATUS_FIELD_KEY = process.env.HOLDED_PIPE_DEAL_STATUS_FIELD_KEY || 'ce2c299bd19c48d40297cd7b204780585ab2a5f0';
const DEAL_FUNDAE_FIELD_KEY = process.env.HOLDED_PIPE_DEAL_FUNDAE_FIELD_KEY || '245d60d4d18aec40ba888998ef92e5d00e494583';
const DEAL_CAES_FIELD_KEY = process.env.HOLDED_PIPE_DEAL_CAES_FIELD_KEY || 'e1971bf3a21d48737b682bf8d864ddc5eb15a351';
const DEAL_SITE_FIELD_KEY = process.env.HOLDED_PIPE_DEAL_SITE_FIELD_KEY || '676d6bd51e52999c582c01f67c99a35ed30bf6ae';
const DEAL_ROUTE_SITE_FIELD_KEY = process.env.HOLDED_PIPE_DEAL_ROUTE_SITE_FIELD_KEY || '21e21e35f209ba485a2e8a209e35eda396875d11';
const DEAL_SERVICE_FIELD_KEY = process.env.HOLDED_PIPE_DEAL_SERVICE_FIELD_KEY || 'e72120b9e27221b560c8480ff422f3fe28f8dbae';

const DEFAULT_ORG_ACQUISITION_CHANNEL = parseIntegerEnv(process.env.HOLDED_PIPE_DEFAULT_ACQUISITION_CHANNEL, 176);
const DEFAULT_ORG_COMPANY_TYPE = parseIntegerEnv(process.env.HOLDED_PIPE_DEFAULT_COMPANY_TYPE, 59);
const DEFAULT_DEAL_STATUS = parseIntegerEnv(process.env.HOLDED_PIPE_DEFAULT_STATUS_VALUE, 63);
const DEFAULT_DEAL_FUNDAE = parseIntegerEnv(process.env.HOLDED_PIPE_DEFAULT_FUNDAE_VALUE, 85);
const DEFAULT_DEAL_CAES = parseIntegerEnv(process.env.HOLDED_PIPE_DEFAULT_CAES_VALUE, 25);
const DEFAULT_DEAL_SITE = parseIntegerEnv(process.env.HOLDED_PIPE_DEFAULT_SITE_VALUE, 49);
const DEFAULT_DEAL_ROUTE_SITE = parseIntegerEnv(process.env.HOLDED_PIPE_DEFAULT_ROUTE_SITE_VALUE, 225);
const DEFAULT_DEAL_SERVICE = parseIntegerEnv(process.env.HOLDED_PIPE_DEFAULT_SERVICE_VALUE, 236);
const DEFAULT_ORG_SOURCE_TEXT = process.env.HOLDED_PIPE_DEFAULT_ORG_SOURCE_TEXT || 'Creado desde Contabilidad';
const DEAL_TITLE_PREFIX = process.env.HOLDED_PIPE_TITLE_PREFIX || 'Contabilidad -';
const PRODUCT_COMMENT_PREFIX = process.env.HOLDED_PIPE_PRODUCT_COMMENT_PREFIX || 'Presupuesto creado desde contabilidad, confirmar la información que sea correcta.';
const EXPECTED_TOKEN = process.env.HOLDED_TO_PIPEDRIVE_TOKEN || process.env.HOLDED_PIPE_TOKEN || null;

function parseIntegerEnv(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized.length) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function readArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

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
    const objectValue = value as Record<string, unknown>;
    const candidates = [
      objectValue.label,
      objectValue.name,
      objectValue.value,
      objectValue.code,
      objectValue.id,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeText(candidate);
      if (normalized) return normalized;
    }
  }
  return null;
}

function normalizeDateText(value: unknown): string | null {
  const text = readString(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString();
}

function normalizeSkuToPipedriveId(rawSku: string | null): string | null {
  if (!rawSku) return null;
  const matches = rawSku.match(/\d+/g);
  if (!matches?.length) return null;
  return matches.join('');
}

function toIntegerIdOrNull(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && Number.isFinite(value) ? value : null;
  }
  const text = readString(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractSearchItems(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data?.items)) return payload.data.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function extractItemEntity(entry: any): any {
  return entry?.item ?? entry;
}

function extractEntityId(entity: any): string | null {
  const directId = readString(entity?.id);
  if (directId) return directId;
  return readString(entity?.item?.id);
}

function buildDealTitle(invoice: NormalizedHoldedInvoice): string {
  const normalizedPrefix = DEAL_TITLE_PREFIX.trim().replace(/\s*-\s*$/, '');
  const parts = [normalizedPrefix, invoice.contactName];
  if (invoice.invoiceNumber) {
    parts.push(invoice.invoiceNumber);
  } else if (invoice.invoiceId) {
    parts.push(invoice.invoiceId);
  }
  return parts.filter((value) => value.length > 0).join(' - ');
}

function buildAddressText(invoice: NormalizedHoldedInvoice): string | null {
  return readString(invoice.billAddress);
}

function normalizeHoldedInvoice(body: unknown): NormalizedHoldedInvoice {
  const raw = readObject(body) ?? {};
  const from = readObject(raw.from);
  const products = readArray<JsonObject>(raw.products).map((product) => ({
    sku: normalizeText(product.sku),
    name: normalizeText(product.name),
    description: normalizeText(product.desc ?? product.description ?? product.comments),
    price: readNumber(product.price),
    quantity: readNumber(product.units) ?? 1,
    taxPercentage: readNumber(product.tax),
    discountPercentage: readNumber(product.discount),
  }));

  return {
    invoiceId: normalizeText(raw.id ?? raw._id ?? raw.invoiceId ?? raw.documentId),
    invoiceNumber: normalizeText(raw.docNumber ?? raw.number ?? raw.invoiceNumber),
    contactName: normalizeText(raw.contactName) ?? 'Cliente sin nombre',
    contactCode: normalizeText(raw.contactCode ?? raw.code ?? raw.contactCodeTax),
    billAddress: normalizeText(readObject(raw.billAddress)?.address ?? raw.address),
    invoiceDate: normalizeDateText(raw.date),
    notes: normalizeText(raw.notes),
    docType: normalizeText(raw.docType ?? raw.documentType),
    customFieldsPresent: readArray(raw.customFields).some((entry) => Boolean(readObject(entry)?.field)),
    sourceDocType: normalizeText(from?.docType),
    products,
    raw,
  };
}

function isBlockedInvoice(invoice: NormalizedHoldedInvoice): string | null {
  if (invoice.customFieldsPresent) {
    return 'La factura contiene customFields y se excluye de esta automatización.';
  }
  if (invoice.sourceDocType) {
    return 'La factura proviene de un documento previo y no se debe recrear en Pipedrive.';
  }
  if (invoice.notes && invoice.notes.toLowerCase().includes('pedido online:')) {
    return 'La factura es de tipo Pedido Online y se excluye de esta automatización.';
  }
  return null;
}

async function pdRequest(path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}) {
  const baseUrl = process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    throw new Error('Falta PIPEDRIVE_API_TOKEN en variables de entorno');
  }

  const url = `${baseUrl}${path}${path.includes('?') ? '&' : '?'}api_token=${token}`;
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`[pipedrive] ${init.method ?? 'GET'} ${path} -> ${response.status} ${text}`);
  }
  return json;
}

function findExactOrganization(items: any[], cif: string | null, companyName: string): any | null {
  const normalizedCif = readString(cif)?.toLowerCase() ?? null;
  const normalizedCompany = companyName.toLowerCase();

  for (const entry of items) {
    const item = extractItemEntity(entry);
    const itemCif = readString(item?.[ORG_CIF_FIELD_KEY])?.toLowerCase() ?? null;
    if (normalizedCif && itemCif === normalizedCif) {
      return item;
    }
  }

  for (const entry of items) {
    const item = extractItemEntity(entry);
    const name = readString(item?.name)?.toLowerCase() ?? null;
    if (name === normalizedCompany) {
      return item;
    }
  }

  return null;
}

async function searchOrganization(invoice: NormalizedHoldedInvoice): Promise<any | null> {
  const queries = [invoice.contactCode, invoice.contactName].filter((value): value is string => Boolean(readString(value)));
  for (const query of queries) {
    const response = await pdRequest(
      `/organizations/search?term=${encodeURIComponent(query)}&fields=custom_fields,name&exact_match=true&limit=10`,
    );
    const match = findExactOrganization(extractSearchItems(response), invoice.contactCode, invoice.contactName);
    if (match) return match;
  }
  return null;
}

function findExactDeal(items: any[], title: string): any | null {
  const normalizedTitle = title.trim().toLowerCase();
  for (const entry of items) {
    const item = extractItemEntity(entry);
    const itemTitle = readString(item?.title)?.toLowerCase() ?? null;
    if (itemTitle === normalizedTitle) {
      return item;
    }
  }
  return null;
}

async function searchDeal(title: string): Promise<any | null> {
  const response = await pdRequest(
    `/deals/search?term=${encodeURIComponent(title)}&fields=title&exact_match=true&limit=10`,
  );
  return findExactDeal(extractSearchItems(response), title);
}

async function ensureNote(dealId: string, organizationId: string, content: string): Promise<boolean> {
  const existingNotes = await getDealNotes(dealId);
  const notes = Array.isArray(existingNotes) ? existingNotes : [];
  if (notes.some((note) => readString((note as any)?.content) === content)) {
    return false;
  }

  await pdRequest('/notes', {
    method: 'POST',
    body: {
      content,
      deal_id: dealId,
      org_id: organizationId,
      pinned_to_deal_flag: 1,
    },
  });
  return true;
}

async function ensureDealProduct(
  dealId: string,
  productIdPipe: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const existingProducts = await getDealProducts(dealId);
  const products = Array.isArray(existingProducts) ? existingProducts : [];
  const matchingProduct = products.find(
    (product) =>
      readString((product as any)?.product_id) === productIdPipe ||
      readString((product as any)?.product?.id) === productIdPipe,
  );

  if (matchingProduct) {
    const dealProductId =
      readString((matchingProduct as any)?.id) ??
      readString((matchingProduct as any)?.deal_product_id) ??
      readString((matchingProduct as any)?.product_attachment_id);

    if (!dealProductId) {
      return false;
    }

    await pdRequest(`/deals/${encodeURIComponent(dealId)}/products/${encodeURIComponent(dealProductId)}`, {
      method: 'PUT',
      body: payload,
    });
    return true;
  }

  await pdRequest(`/deals/${encodeURIComponent(dealId)}/products`, {
    method: 'POST',
    body: payload,
  });
  return true;
}

function buildOrganizationPayload(invoice: NormalizedHoldedInvoice) {
  return {
    name: invoice.contactName,
    owner_id: DEFAULT_OWNER_ID,
    visible_to: DEFAULT_VISIBLE_TO,
    address: buildAddressText(invoice),
    [ORG_CIF_FIELD_KEY]: invoice.contactCode,
    [ORG_EMAIL_FIELD_KEY]: undefined,
    [ORG_ACQUISITION_CHANNEL_FIELD_KEY]: DEFAULT_ORG_ACQUISITION_CHANNEL,
    [ORG_COMPANY_TYPE_FIELD_KEY]: DEFAULT_ORG_COMPANY_TYPE,
    [ORG_SOURCE_FIELD_KEY]: DEFAULT_ORG_SOURCE_TEXT,
  };
}

function buildDealCreatePayload(invoice: NormalizedHoldedInvoice, organizationId: string, title: string) {
  return {
    title,
    add_time: invoice.invoiceDate ?? undefined,
    status: 'open',
    stage_id: DEFAULT_OPEN_STAGE_ID,
    pipeline_id: DEFAULT_PIPELINE_ID,
    user_id: DEFAULT_OWNER_ID,
    org_id: organizationId,
    visible_to: DEFAULT_VISIBLE_TO,
    person_id: undefined,
    [DEAL_STATUS_FIELD_KEY]: DEFAULT_DEAL_STATUS,
    [DEAL_FUNDAE_FIELD_KEY]: DEFAULT_DEAL_FUNDAE,
    [DEAL_CAES_FIELD_KEY]: DEFAULT_DEAL_CAES,
    [DEAL_SITE_FIELD_KEY]: DEFAULT_DEAL_SITE,
    [DEAL_ROUTE_SITE_FIELD_KEY]: DEFAULT_DEAL_ROUTE_SITE,
    [DEAL_SERVICE_FIELD_KEY]: DEFAULT_DEAL_SERVICE,
    [DEAL_ADDRESS_FIELD_KEY]: buildAddressText(invoice),
    [DEAL_CONTACT_CODE_FIELD_KEY]: invoice.contactCode,
  };
}

function buildDealUpdatePayload(invoice: NormalizedHoldedInvoice) {
  return {
    status: 'won',
    stage_id: DEFAULT_WON_STAGE_ID,
    user_id: DEFAULT_OWNER_ID,
    visible_to: DEFAULT_VISIBLE_TO,
    [DEAL_STATUS_FIELD_KEY]: DEFAULT_DEAL_STATUS,
    [DEAL_FUNDAE_FIELD_KEY]: DEFAULT_DEAL_FUNDAE,
    [DEAL_CAES_FIELD_KEY]: DEFAULT_DEAL_CAES,
    [DEAL_SITE_FIELD_KEY]: DEFAULT_DEAL_SITE,
    [DEAL_ROUTE_SITE_FIELD_KEY]: DEFAULT_DEAL_ROUTE_SITE,
    [DEAL_SERVICE_FIELD_KEY]: DEFAULT_DEAL_SERVICE,
    [DEAL_ADDRESS_FIELD_KEY]: buildAddressText(invoice),
    [DEAL_CONTACT_CODE_FIELD_KEY]: invoice.contactCode,
  };
}

function buildDealProductComment(product: HoldedInvoiceProduct): string {
  return `${PRODUCT_COMMENT_PREFIX}${product.description ?? ''}`;
}

function buildAddProductPayload(product: HoldedInvoiceProduct, productIdPipe: string) {
  const normalizedProductId = toIntegerIdOrNull(productIdPipe);
  if (normalizedProductId === null) {
    throw new Error(`El product_id de Pipedrive no es un entero válido: ${productIdPipe}`);
  }

  return {
    product_id: normalizedProductId,
    item_price: product.price ?? undefined,
    quantity: product.quantity > 0 ? product.quantity : 1,
    discount: (product.discountPercentage ?? 0) > 0 ? product.discountPercentage : undefined,
    discount_type: 'percentage',
    tax_method: 'exclusive',
    tax: product.taxPercentage ?? undefined,
    comments: buildDealProductComment(product),
    is_enabled: true,
  };
}

async function resolvePipedriveProductId(product: HoldedInvoiceProduct): Promise<string | null> {
  const prisma = getPrisma();
  const skuDigits = normalizeSkuToPipedriveId(product.sku);
  if (skuDigits) {
    const direct = await prisma.products.findFirst({
      where: { id_pipe: skuDigits },
      select: { id_pipe: true },
    });
    if (direct?.id_pipe) {
      return direct.id_pipe;
    }
    return skuDigits;
  }

  const skuText = readString(product.sku);
  const nameText = readString(product.name);
  if (!skuText && !nameText) {
    return null;
  }

  const fallback = await prisma.products.findFirst({
    where: {
      OR: [
        ...(skuText ? [{ id_holded: skuText }, { code: skuText }] : []),
        ...(nameText ? [{ name: nameText }] : []),
      ],
    },
    select: { id_pipe: true },
  });

  return fallback?.id_pipe ?? null;
}

function buildInvoiceNote(invoice: NormalizedHoldedInvoice): string {
  const lines = [
    'Factura recibida desde Holded y convertida automáticamente en presupuesto de Pipedrive.',
    invoice.invoiceNumber ? `Número factura: ${invoice.invoiceNumber}` : null,
    invoice.invoiceId ? `ID factura Holded: ${invoice.invoiceId}` : null,
    invoice.invoiceDate ? `Fecha: ${invoice.invoiceDate}` : null,
    invoice.notes ? `Notas Holded: ${invoice.notes}` : null,
  ].filter((value): value is string => Boolean(value));

  return lines.join('\n');
}

function resolveToken(headers: Record<string, string | undefined>): string | null {
  const authorization = readString(headers.authorization ?? headers.Authorization);
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return readString(authorization.slice(7));
  }
  return readString(
    headers['x-holded-webhook-token'] ??
    headers['X-Holded-Webhook-Token'] ??
    headers['x-erp-token'] ??
    headers['X-Erp-Token'],
  );
}

async function syncInvoiceToPipedrive(invoice: NormalizedHoldedInvoice): Promise<SyncResult> {
  const title = buildDealTitle(invoice);
  const existingOrganization = await searchOrganization(invoice);
  const organizationPayload = buildOrganizationPayload(invoice);
  const organizationEntity = existingOrganization
    ? await pdRequest(`/organizations/${encodeURIComponent(String(extractEntityId(existingOrganization)))}`, {
        method: 'PUT',
        body: organizationPayload,
      })
    : await pdRequest('/organizations', { method: 'POST', body: organizationPayload });

  const organizationId = extractEntityId(organizationEntity?.data ?? organizationEntity);
  if (!organizationId) {
    throw new Error('No se ha podido resolver la organización en Pipedrive.');
  }

  const existingDeal = await searchDeal(title);
  const dealEntity = existingDeal
    ? await pdRequest(`/deals/${encodeURIComponent(String(extractEntityId(existingDeal)))}`, {
        method: 'PUT',
        body: buildDealUpdatePayload(invoice),
      })
    : await pdRequest('/deals', {
        method: 'POST',
        body: buildDealCreatePayload(invoice, organizationId, title),
      });

  const dealId = extractEntityId(dealEntity?.data ?? dealEntity);
  if (!dealId) {
    throw new Error('No se ha podido resolver el deal en Pipedrive.');
  }

  const warnings: string[] = [];
  let productsProcessed = 0;
  let productsSkipped = 0;

  for (const product of invoice.products) {
    const productIdPipe = await resolvePipedriveProductId(product);
    if (!productIdPipe) {
      productsSkipped += 1;
      warnings.push(
        `No se ha podido resolver el producto de Pipedrive para SKU "${product.sku ?? '—'}" (${product.name ?? 'Sin nombre'}).`,
      );
      continue;
    }

    await ensureDealProduct(dealId, productIdPipe, buildAddProductPayload(product, productIdPipe));
    productsProcessed += 1;
  }

  await ensureNote(dealId, organizationId, buildInvoiceNote(invoice));
  await pdRequest(`/deals/${encodeURIComponent(dealId)}`, {
    method: 'PUT',
    body: buildDealUpdatePayload(invoice),
  });

  await importDealFromPipedrive(dealId);

  return {
    organizationId,
    dealId,
    title,
    createdOrganization: !existingOrganization,
    createdDeal: !existingDeal,
    productsProcessed,
    productsSkipped,
    warnings,
  };
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const resolvedToken = resolveToken(request.headers ?? {});
  if (EXPECTED_TOKEN && resolvedToken !== EXPECTED_TOKEN) {
    return errorResponse('INVALID_TOKEN', 'Token no válido.', 401);
  }

  const invoice = normalizeHoldedInvoice(request.body);
  const blockedReason = isBlockedInvoice(invoice);
  if (blockedReason) {
    return successResponse({ skipped: true, reason: blockedReason });
  }

  if (!invoice.products.length) {
    return errorResponse('NO_PRODUCTS', 'La factura no contiene líneas de producto procesables.', 400);
  }

  try {
    const result = await syncInvoiceToPipedrive(invoice);
    return successResponse({ skipped: false, ...result });
  } catch (error) {
    console.error('[holded-invoice-to-pipedrive] sync failed', { invoiceId: invoice.invoiceId, error });
    const message = error instanceof Error ? error.message : 'No se pudo sincronizar la factura con Pipedrive.';
    return errorResponse('HOLDED_TO_PIPEDRIVE_SYNC_ERROR', message, 500);
  }
});
