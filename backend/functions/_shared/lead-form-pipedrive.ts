import type { PrismaClient } from '@prisma/client';

import { getDealFields, listAllProducts } from './pipedrive';
import { getSlackToken } from './slackConfig';

type JsonObject = Record<string, unknown>;

type LeadFormCategory = 'open' | 'enterprise';
type EnterpriseRoute = 'sabadell' | 'in_company' | 'resto_peninsula' | 'madrid';

type NormalizedLeadForm = {
  webhookEventId: string;
  leadName: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  companyName: string | null;
  observations: string | null;
  trafficSource: string | null;
  courseName: string | null;
  siteName: string | null;
  category: LeadFormCategory | null;
  categoryLabel: string | null;
  route: EnterpriseRoute | null;
  sourceWebsite: string | null;
};

type LeadFormSyncResult = {
  webhookEventId: string;
  category: LeadFormCategory;
  route: EnterpriseRoute | 'open';
  organizationId: string;
  personId: string;
  recordId: string;
  recordType: 'deal' | 'lead';
  organizationCreated: boolean;
  personCreated: boolean;
  recordCreated: boolean;
  productAdded: boolean;
  slackSent: boolean;
  warnings: string[];
};

type PipedriveOption = { id?: number | string; label?: string | null; name?: string | null; key?: string | number | null };
type PipedriveField = { key?: string; name?: string | null; options?: PipedriveOption[] | null };
type PipedriveSearchResponseItem = { item?: { id?: number | string } | null };

type ProductMatch = { id: string; name: string | null; price: number | null };

type RouteConfig = {
  route: EnterpriseRoute;
  ownerId: number;
  searchExact: boolean;
  siteLabelCandidates: string[];
  slackChannelId: string;
};

const PIPEDRIVE_BASE_URL = String(process.env.PIPEDRIVE_BASE_URL ?? 'https://api.pipedrive.com/v1').trim();
const PIPEDRIVE_API_ROOT = PIPEDRIVE_BASE_URL.replace(/\/v1\/?$/i, '');
const PIPEDRIVE_TOKEN = String(process.env.PIPEDRIVE_API_TOKEN ?? '').trim();

const DEFAULT_VISIBLE_TO = parseIntegerEnv(process.env.LEAD_FORM_PIPE_VISIBLE_TO, 7);
const DEFAULT_OWNER_ID = parseIntegerEnv(process.env.LEAD_FORM_PIPE_DEFAULT_OWNER_ID, 13444807);
const DEFAULT_PIPELINE_ID = parseIntegerEnv(process.env.LEAD_FORM_PIPE_PIPELINE_ID, 3);
const DEFAULT_STAGE_ID = parseIntegerEnv(process.env.LEAD_FORM_PIPE_STAGE_ID, 13);
const DEFAULT_DEAL_SERVICE_VALUE = String(process.env.LEAD_FORM_PIPE_DEAL_SERVICE_VALUE ?? '234').trim();
const DEFAULT_DEAL_STATUS_VALUE = String(process.env.LEAD_FORM_PIPE_DEAL_STATUS_VALUE ?? '64').trim();
const DEFAULT_DEAL_SOURCE_TEXT = String(process.env.LEAD_FORM_PIPE_DEAL_SOURCE_TEXT ?? 'Lead Web').trim();
const DEFAULT_LEAD_SOURCE_VALUE = String(process.env.LEAD_FORM_PIPE_LEAD_SOURCE_VALUE ?? 'Directa').trim();
const DEFAULT_PERSON_LABEL = String(process.env.LEAD_FORM_PIPE_PERSON_LABEL ?? '146').trim();
const DEFAULT_DEAL_LABEL = String(process.env.LEAD_FORM_PIPE_DEAL_LABEL ?? '370').trim();
const DEFAULT_FALLBACK_PRODUCT_ID = String(process.env.LEAD_FORM_PIPE_FALLBACK_PRODUCT_ID ?? '203').trim();
const DEFAULT_FALLBACK_PRODUCT_PRICE = parseFloatEnv(process.env.LEAD_FORM_PIPE_FALLBACK_PRODUCT_PRICE, 185);
const DEFAULT_OPEN_CHANNEL_ID = String(process.env.LEAD_FORM_PIPE_OPEN_SLACK_CHANNEL ?? 'C06P4G70GJD').trim();
const DEFAULT_ENTERPRISE_CHANNEL_ID = String(process.env.LEAD_FORM_PIPE_ENTERPRISE_SLACK_CHANNEL ?? 'C05PBDREZ54').trim();

const ORG_PHONE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_PHONE_FIELD_KEY ?? 'b4379db06dfbe0758d84c2c2dd45ef04fa093b6d').trim();
const ORG_COMPANY_TYPE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_COMPANY_TYPE_FIELD_KEY ?? '8a65e9b780cbab3f08ccc8babe92a290fb79f216').trim();
const ORG_ACQUISITION_CHANNEL_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_ACQUISITION_CHANNEL_FIELD_KEY ?? '6eb20e6b912f055c127241c9012f20a8223637f6').trim();
const ORG_TRAFFIC_SOURCE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_TRAFFIC_SOURCE_FIELD_KEY ?? '0fc89035ac2e1b484953c6733a81e6693047d1ec').trim();
const ORG_CIF_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_CIF_FIELD_KEY ?? '6d39d015a33921753410c1bab0b067ca93b8cf2c').trim();
const ORG_PAYMENT_METHOD_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_PAYMENT_METHOD_FIELD_KEY ?? 'bd8ac0c959d5a9a98908523b7f86a49cbdedb988').trim();
const ORG_ACQUISITION_METHOD_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_ACQUISITION_METHOD_FIELD_KEY ?? 'd47b5a37815847980d6ed7b25460e7f33a445da6').trim();
const ORG_PRIORITY_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_PRIORITY_FIELD_KEY ?? '940ca2a3d3462e024ccf9b38a26e4a4cb070e7c8').trim();
const ORG_ADDRESS_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_ADDRESS_FIELD_KEY ?? 'address').trim();
const ORG_NEWSLETTER_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_NEWSLETTER_FIELD_KEY ?? '57ff065353ac0e8d95e3e4415cc97ba2b10eb34b').trim();
const ORG_BONIFICABLE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_ORG_BONIFICABLE_FIELD_KEY ?? '6d39d015a33921753410c1bab0b067ca93b8cf2c').trim();

const PERSON_TRAFFIC_SOURCE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_PERSON_TRAFFIC_SOURCE_FIELD_KEY ?? 'adc9b64ef6039268a964a24b402f72b67316a49d').trim();
const PERSON_SOURCE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_PERSON_SOURCE_FIELD_KEY ?? '998c7e1a3e1c9ffe37530780e3c989e6f35cd36b').trim();

const DEAL_SITE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_SITE_FIELD_KEY ?? '676d6bd51e52999c582c01f67c99a35ed30bf6ae').trim();
const DEAL_STATUS_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_STATUS_FIELD_KEY ?? 'ce2c299bd19c48d40297cd7b204780585ab2a5f0').trim();
const DEAL_FUNDAE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_FUNDAE_FIELD_KEY ?? '245d60d4d18aec40ba888998ef92e5d00e494583').trim();
const DEAL_SERVICE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_SERVICE_FIELD_KEY ?? 'e72120b9e27221b560c8480ff422f3fe28f8dbae').trim();
const DEAL_TRAFFIC_SOURCE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_TRAFFIC_SOURCE_FIELD_KEY ?? 'abfa216589d01466453514fdcfeb1c6e5b9fdf8d').trim();
const DEAL_SOURCE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_SOURCE_FIELD_KEY ?? 'c6eabce7c04f864646aa72c944f875fd71cdf178').trim();
const DEAL_TRAINING_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_TRAINING_FIELD_KEY ?? 'c99554c188c3f63ad9bc8b2cf7b50cbd145455ab').trim();
const DEAL_LABEL_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_LABEL_FIELD_KEY ?? 'label').trim();

const LEAD_TRAINING_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_TRAINING_FIELD_KEY ?? 'c99554c188c3f63ad9bc8b2cf7b50cbd145455ab').trim();
const LEAD_SITE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_SITE_FIELD_KEY ?? '676d6bd51e52999c582c01f67c99a35ed30bf6ae').trim();
const LEAD_STATUS_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_STATUS_FIELD_KEY ?? 'ce2c299bd19c48d40297cd7b204780585ab2a5f0').trim();
const LEAD_SERVICE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_SERVICE_FIELD_KEY ?? 'e72120b9e27221b560c8480ff422f3fe28f8dbae').trim();
const LEAD_TRAFFIC_SOURCE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_TRAFFIC_SOURCE_FIELD_KEY ?? 'abfa216589d01466453514fdcfeb1c6e5b9fdf8d').trim();
const LEAD_CHANNEL_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_CHANNEL_FIELD_KEY ?? '35d37547db294a690fb087e3d86b30471f057186').trim();

const OPEN_CATEGORY_MATCHERS = [
  'individual / autónomo / particulares',
  'individual / autonomo / particulares',
];

const ENTERPRISE_CATEGORY_MATCHERS = [
  'empresa que quiere formar a menos de 5 personas',
  'empresa / grupos / formación adaptada',
  'empresa / grupos / formacion adaptada',
];

const ENTERPRISE_ROUTES: RouteConfig[] = [
  {
    route: 'sabadell',
    ownerId: parseIntegerEnv(process.env.LEAD_FORM_PIPE_OWNER_SABADELL, 13957858),
    searchExact: false,
    siteLabelCandidates: ['Sabadell', 'GEP Sabadell'],
    slackChannelId: DEFAULT_ENTERPRISE_CHANNEL_ID,
  },
  {
    route: 'in_company',
    ownerId: parseIntegerEnv(process.env.LEAD_FORM_PIPE_OWNER_IN_COMPANY, 13957858),
    searchExact: false,
    siteLabelCandidates: ['In Company'],
    slackChannelId: DEFAULT_ENTERPRISE_CHANNEL_ID,
  },
  {
    route: 'resto_peninsula',
    ownerId: parseIntegerEnv(process.env.LEAD_FORM_PIPE_OWNER_RESTO_PENINSULA, 22146585),
    searchExact: false,
    siteLabelCandidates: ['Resto Península (Sólo empresas)', 'In Company'],
    slackChannelId: DEFAULT_ENTERPRISE_CHANNEL_ID,
  },
  {
    route: 'madrid',
    ownerId: parseIntegerEnv(process.env.LEAD_FORM_PIPE_OWNER_MADRID, 22146585),
    searchExact: true,
    siteLabelCandidates: ['Madrid', 'Arganda', 'GEP Arganda'],
    slackChannelId: DEFAULT_ENTERPRISE_CHANNEL_ID,
  },
];

function parseIntegerEnv(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(rawValue ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatEnv(rawValue: string | undefined, fallback: number): number {
  const normalized = String(rawValue ?? '').trim().replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function readObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value: string | null): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function includesNormalized(source: string | null, target: string): boolean {
  return normalizeText(source).includes(normalizeText(target));
}

function pickFirstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return null;
}

function joinName(...values: Array<string | null>): string | null {
  const parts = values.map((value) => String(value ?? '').trim()).filter((value) => value.length > 0);
  return parts.length ? parts.join(' ') : null;
}

function resolvePayloadRoot(payload: unknown): JsonObject {
  const root = readObject(payload) ?? {};
  const nested = readObject(root.payload) ?? readObject(root.data) ?? readObject(root.entry) ?? readObject(root.submission);
  return nested ?? root;
}

function detectCategory(label: string | null): LeadFormCategory | null {
  if (!label) return null;
  if (OPEN_CATEGORY_MATCHERS.some((item) => includesNormalized(label, item))) {
    return 'open';
  }
  if (ENTERPRISE_CATEGORY_MATCHERS.some((item) => includesNormalized(label, item))) {
    return 'enterprise';
  }
  return null;
}

function detectEnterpriseRoute(siteName: string | null): EnterpriseRoute | null {
  if (!siteName) return null;
  if (includesNormalized(siteName, 'Sabadell')) return 'sabadell';
  if (includesNormalized(siteName, 'In Company')) return 'in_company';
  if (includesNormalized(siteName, 'Resto Península') || includesNormalized(siteName, 'Resto Peninsula')) return 'resto_peninsula';
  if (includesNormalized(siteName, 'Madrid')) return 'madrid';
  return null;
}

function resolveSourceWebsite(headers: JsonObject | null, source: string | null): string | null {
  const userAgent = readString(headers?.['user-agent']);
  if (userAgent?.includes('https://gepcoformacion.es')) {
    return 'GEPCO';
  }
  if (userAgent?.includes('https://gepservices.es')) {
    return 'GEP Services';
  }
  return source;
}

function normalizeLeadFormFromWebhook(record: {
  id: string;
  source: string | null;
  request_headers: unknown;
  payload_json: unknown;
}): NormalizedLeadForm {
  const root = resolvePayloadRoot(record.payload_json);
  const fields = readObject(root.fields);
  const contact = readObject(root.contact) ?? readObject(root.lead);
  const categoryLabel = pickFirstText(root['menu-659'], fields?.['menu-659']);
  const siteName = pickFirstText(root['menu-658'], fields?.['menu-658'], root.sede, root.site);
  const leadName =
    joinName(pickFirstText(contact?.first_name, root.first_name), pickFirstText(contact?.last_name, root.last_name)) ??
    pickFirstText(root['your-name'], fields?.['your-name'], root.nombre, contact?.name, root.name);
  const headers = readObject(record.request_headers);

  return {
    webhookEventId: record.id,
    leadName,
    leadEmail: pickFirstText(root['your-email'], fields?.['your-email'], root.email, contact?.email),
    leadPhone: pickFirstText(root['tel-383'], fields?.['tel-383'], root.telefono, root.phone, contact?.phone),
    companyName: pickFirstText(root['nombre-empresa'], fields?.['nombre-empresa'], root.company, root.empresa),
    observations: pickFirstText(root['your-observaciones'], fields?.['your-observaciones'], root.observaciones, root.message),
    trafficSource: pickFirstText(root.traffic_source, fields?.traffic_source, root.utm_source),
    courseName: pickFirstText(root['uacf7_dynamic_text-116'], fields?.['uacf7_dynamic_text-116'], root.course, root.curso),
    siteName,
    category: detectCategory(categoryLabel),
    categoryLabel,
    route: detectEnterpriseRoute(siteName),
    sourceWebsite: resolveSourceWebsite(headers, record.source),
  };
}

function assertPipedriveConfigured(): void {
  if (!PIPEDRIVE_TOKEN.length) {
    throw new Error('Falta la variable PIPEDRIVE_API_TOKEN para procesar el lead en el ERP.');
  }
}

function buildResponsePreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 240);
}

async function readJsonResponse<T>(
  response: Response,
  serviceName: string,
  operationDescription: string,
): Promise<{ text: string; json: T | null }> {
  const text = await response.text().catch(() => '');
  if (!text.trim().length) {
    return { text, json: null };
  }

  try {
    return { text, json: JSON.parse(text) as T };
  } catch (error) {
    const preview = buildResponsePreview(text);
    const detail = preview.length ? ` Respuesta recibida: ${preview}` : '';
    throw new Error(
      `${serviceName} devolvió una respuesta no JSON durante ${operationDescription} (${response.status}).${detail}`.trim(),
    );
  }
}

async function pdRequest<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  assertPipedriveConfigured();
  const separator = path.includes('?') ? '&' : '?';
  const url = `${PIPEDRIVE_BASE_URL}${path}${separator}api_token=${encodeURIComponent(PIPEDRIVE_TOKEN)}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const { text, json } = await readJsonResponse<{ data?: T; success?: boolean; error?: string }>(
    response,
    'Pipedrive',
    `${init?.method ?? 'GET'} ${path}`,
  );
  if (!response.ok || json?.success === false) {
    const details = json?.error ? ` ${json.error}` : text ? ` ${buildResponsePreview(text)}` : '';
    throw new Error(`Pipedrive ${init?.method ?? 'GET'} ${path} falló (${response.status}).${details}`.trim());
  }

  return (json?.data ?? null) as T;
}

function buildSearchParams(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}

async function searchOrganizationByName(name: string, exactMatch: boolean): Promise<{ id: string } | null> {
  const query = buildSearchParams({ term: name, exact_match: exactMatch ? 1 : 0, fields: 'name', limit: 10 });
  const data = await pdRequest<{ items?: PipedriveSearchResponseItem[] }>(`/organizations/search?${query}`);
  const items = Array.isArray(data?.items) ? data.items : [];
  const match = items.find((entry) => entry?.item?.id != null);
  return match?.item?.id != null ? { id: String(match.item.id) } : null;
}

async function searchPersonByEmail(email: string): Promise<{ id: string } | null> {
  const query = buildSearchParams({ term: email, exact_match: 1, fields: 'email', limit: 10 });
  const data = await pdRequest<{ items?: PipedriveSearchResponseItem[] }>(`/persons/search?${query}`);
  const items = Array.isArray(data?.items) ? data.items : [];
  const match = items.find((entry) => entry?.item?.id != null);
  return match?.item?.id != null ? { id: String(match.item.id) } : null;
}

async function searchLeadByTitle(title: string): Promise<{ id: string } | null> {
  const query = buildSearchParams({ term: title, exact_match: 1, item_types: 'lead', fields: 'title', limit: 10 });
  const data = await pdRequest<{ items?: PipedriveSearchResponseItem[] }>(`/itemSearch?${query}`);
  const items = Array.isArray(data?.items) ? data.items : [];
  const match = items.find((entry) => entry?.item?.id != null);
  return match?.item?.id != null ? { id: String(match.item.id) } : null;
}

async function createOrganization(payload: Record<string, unknown>): Promise<{ id: string }> {
  const data = await pdRequest<{ id?: number | string }>('/organizations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (data?.id == null) {
    throw new Error('Pipedrive no devolvió el id de la organización.');
  }
  return { id: String(data.id) };
}

async function updateOrganization(id: string, payload: Record<string, unknown>): Promise<void> {
  await pdRequest(`/organizations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

async function createPerson(payload: Record<string, unknown>): Promise<{ id: string; ownerName: string | null }> {
  const data = await pdRequest<{ id?: number | string; owner_name?: string | null }>('/persons', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (data?.id == null) {
    throw new Error('Pipedrive no devolvió el id de la persona.');
  }
  return { id: String(data.id), ownerName: readString(data.owner_name) };
}

async function updatePerson(id: string, payload: Record<string, unknown>): Promise<{ ownerName: string | null }> {
  const data = await pdRequest<{ owner_name?: string | null }>(`/persons/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return { ownerName: readString(data?.owner_name) };
}

async function createDeal(payload: Record<string, unknown>): Promise<{ id: string }> {
  const data = await pdRequest<{ id?: number | string }>('/deals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (data?.id == null) {
    throw new Error('Pipedrive no devolvió el id del deal.');
  }
  return { id: String(data.id) };
}

async function addProductToDeal(dealId: string, productId: string, itemPrice: number): Promise<void> {
  await pdRequest(`/deals/${encodeURIComponent(dealId)}/products`, {
    method: 'POST',
    body: JSON.stringify({
      product_id: Number.isFinite(Number(productId)) ? Number(productId) : productId,
      item_price: itemPrice,
      quantity: 1,
      enabled_flag: 1,
    }),
  });
}

async function createLead(payload: Record<string, unknown>): Promise<{ id: string; ownerName: string | null }> {
  assertPipedriveConfigured();
  const url = `${PIPEDRIVE_API_ROOT}/api/v2/leads?api_token=${encodeURIComponent(PIPEDRIVE_TOKEN)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const { text, json } = await readJsonResponse<{
    data?: { id?: string | number; owner_id?: { name?: string | null } | null };
    success?: boolean;
    error?: string;
  }>(response, 'Pipedrive', 'POST /api/v2/leads');
  if (!response.ok || json?.success === false) {
    const details = json?.error ? ` ${json.error}` : text ? ` ${buildResponsePreview(text)}` : '';
    throw new Error(`Pipedrive POST /api/v2/leads falló (${response.status}).${details}`.trim());
  }

  const data = json?.data;
  if (data?.id == null) {
    throw new Error('Pipedrive no devolvió el id del lead.');
  }

  return { id: String(data.id), ownerName: readString(data.owner_id?.name) };
}

async function resolveOptionId(fieldKey: string, candidateLabels: Array<string | null | undefined>, fieldsLoader: () => Promise<unknown>): Promise<string | null> {
  const candidates = candidateLabels.map((value) => readString(value)).filter((value): value is string => Boolean(value));
  if (!candidates.length) return null;

  const fields = (await fieldsLoader()) as PipedriveField[];
  const field = fields.find((entry) => entry?.key === fieldKey);
  if (!field || !Array.isArray(field.options)) {
    return null;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    const exact = field.options.find((option) => normalizeText(option.label ?? option.name ?? null) === normalizedCandidate);
    if (exact?.id != null || exact?.key != null) {
      return String(exact.id ?? exact.key);
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    const partial = field.options.find((option) => normalizeText(option.label ?? option.name ?? null).includes(normalizedCandidate));
    if (partial?.id != null || partial?.key != null) {
      return String(partial.id ?? partial.key);
    }
  }

  return null;
}

let cachedProducts: ProductMatch[] | null = null;

async function resolveProductByCourseName(courseName: string): Promise<ProductMatch | null> {
  if (!cachedProducts) {
    const products = await listAllProducts();
    cachedProducts = products.map((product: any) => ({
      id: String(product.id),
      name: readString(product.name),
      price: typeof product.price === 'number' && Number.isFinite(product.price) ? product.price : parseFloatEnv(readString(product.price) ?? undefined, NaN),
    }));
  }

  const normalizedCourse = normalizeText(courseName);
  const exact = cachedProducts.find((product) => normalizeText(product.name) === normalizedCourse);
  if (exact) return exact;

  const partial = cachedProducts.find((product) => normalizeText(product.name).includes(normalizedCourse) || normalizedCourse.includes(normalizeText(product.name)));
  return partial ?? null;
}

async function postSlackMessage(channel: string, messageText: string): Promise<void> {
  const token = getSlackToken();
  if (!token.length) {
    throw new Error('Falta la variable SLACK_TOKEN/SLACK_BOT_TOKEN para notificar el lead.');
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel,
      text: messageText,
      unfurl_links: true,
      unfurl_media: true,
    }),
  });

  const { text, json: payload } = await readJsonResponse<{ ok?: boolean; error?: string }>(
    response,
    'Slack',
    'chat.postMessage',
  );
  if (!response.ok || !payload?.ok) {
    const details = payload?.error
      ? ` (${payload.error})`
      : text.trim().length
        ? ` Respuesta recibida: ${buildResponsePreview(text)}`
        : '';
    throw new Error(`Slack API chat.postMessage falló${details}`);
  }
}

function buildOrganizationPayload(input: NormalizedLeadForm, ownerId: number, typeValue: string): Record<string, unknown> {
  return {
    name: input.companyName,
    owner_id: ownerId,
    visible_to: DEFAULT_VISIBLE_TO,
    [ORG_PHONE_FIELD_KEY]: input.leadPhone,
    [ORG_COMPANY_TYPE_FIELD_KEY]: typeValue,
    [ORG_ACQUISITION_CHANNEL_FIELD_KEY]: '139',
    [ORG_TRAFFIC_SOURCE_FIELD_KEY]: input.trafficSource,
    [ORG_CIF_FIELD_KEY]: 'No',
    [ORG_PAYMENT_METHOD_FIELD_KEY]: input.category === 'open' ? '263' : '223',
    [ORG_ACQUISITION_METHOD_FIELD_KEY]: '168',
    [ORG_PRIORITY_FIELD_KEY]: '176',
    [ORG_ADDRESS_FIELD_KEY]: input.category === 'open' ? 'No' : '',
    [ORG_NEWSLETTER_FIELD_KEY]: input.category === 'open' ? 'No' : '',
    [ORG_BONIFICABLE_FIELD_KEY]: input.category === 'open' ? 'No' : '',
  };
}

function buildPersonPayload(input: NormalizedLeadForm, organizationId: string, ownerId: number, sourceValue: string, marketingStatus: string): Record<string, unknown> {
  return {
    name: input.leadName,
    first_name: input.leadName,
    owner_id: ownerId,
    org_id: organizationId,
    email: input.leadEmail ? [input.leadEmail] : undefined,
    phone: input.leadPhone ? [input.leadPhone] : undefined,
    marketing_status: marketingStatus,
    label: DEFAULT_PERSON_LABEL,
    visible_to: DEFAULT_VISIBLE_TO,
    [PERSON_TRAFFIC_SOURCE_FIELD_KEY]: input.trafficSource,
    [PERSON_SOURCE_FIELD_KEY]: sourceValue,
  };
}

function buildOpenSlackMessage(input: NormalizedLeadForm, organizationName: string, ownerName: string | null): string {
  return [
    'Nuevo Lead -Formacion Abierta para GEPCO',
    `Empresas: GC - ${organizationName}`,
    `Persona Contacto: ${input.leadName ?? '—'}`,
    `Canal: ${input.trafficSource ?? '—'}`,
    `Mail: ${input.leadEmail ?? '—'}`,
    `Curso: ${input.courseName ?? '—'}`,
    `Sede: ${input.siteName ?? '—'}`,
    `Comercial: ${ownerName ?? '—'}`,
    `Observaciones: ${input.observations ?? '—'}`,
  ].join('\n');
}

function buildEnterpriseSlackMessage(input: NormalizedLeadForm, organizationName: string, ownerName: string | null): string {
  return [
    'Nuevo Lead -Formacion Empresa para GEPCO',
    `Empresas: GC - ${organizationName}`,
    `Persona Contacto: ${input.leadName ?? '—'}`,
    `Canal: ${input.trafficSource ?? '—'}`,
    `Mail: ${input.leadEmail ?? '—'}`,
    `Telf: ${input.leadPhone ?? '—'}`,
    `Curso: ${input.courseName ?? '—'}`,
    `Sede: ${input.siteName ?? '—'}`,
    `Comercial: ${ownerName ?? '—'}`,
    `Observaciones: ${input.observations ?? '—'}`,
  ].join('\n');
}

async function upsertOrganization(input: NormalizedLeadForm, ownerId: number, exactMatch: boolean, typeValue: string): Promise<{ id: string; created: boolean }> {
  if (!input.companyName) {
    throw new Error('El webhook no incluye nombre de empresa.');
  }

  const payload = buildOrganizationPayload(input, ownerId, typeValue);
  const found = await searchOrganizationByName(input.companyName, exactMatch);
  if (found) {
    await updateOrganization(found.id, payload);
    return { id: found.id, created: false };
  }

  const created = await createOrganization(payload);
  return { id: created.id, created: true };
}

async function upsertPerson(input: NormalizedLeadForm, organizationId: string, ownerId: number, sourceValue: string, marketingStatus: string): Promise<{ id: string; created: boolean; ownerName: string | null }> {
  if (!input.leadEmail) {
    throw new Error('El webhook no incluye email del lead.');
  }

  const payload = buildPersonPayload(input, organizationId, ownerId, sourceValue, marketingStatus);
  const found = await searchPersonByEmail(input.leadEmail);
  if (found) {
    const updated = await updatePerson(found.id, payload);
    return { id: found.id, created: false, ownerName: updated.ownerName };
  }

  const created = await createPerson(payload);
  return { id: created.id, created: true, ownerName: created.ownerName };
}

async function processOpenLead(input: NormalizedLeadForm): Promise<LeadFormSyncResult> {
  const warnings: string[] = [];
  const organization = await upsertOrganization(input, DEFAULT_OWNER_ID, true, '241');
  const person = await upsertPerson(input, organization.id, DEFAULT_OWNER_ID, '', 'archived');

  const siteOptionId = await resolveOptionId(DEAL_SITE_FIELD_KEY, [input.siteName], getDealFields);
  if (!siteOptionId && input.siteName) {
    warnings.push(`No se ha encontrado la opción de sede para "${input.siteName}".`);
  }

  const trainingOptionId = await resolveOptionId(DEAL_TRAINING_FIELD_KEY, [input.courseName], getDealFields);
  if (!trainingOptionId && input.courseName) {
    warnings.push(`No se ha encontrado la opción de curso para "${input.courseName}".`);
  }

  const dealPayload: Record<string, unknown> = {
    title: `GC- ${input.leadName ?? input.companyName ?? 'Lead Web'}`,
    status: 'open',
    stage_id: DEFAULT_STAGE_ID,
    pipeline_id: DEFAULT_PIPELINE_ID,
    user_id: DEFAULT_OWNER_ID,
    org_id: organization.id,
    person_id: person.id,
    visible_to: DEFAULT_VISIBLE_TO,
    [DEAL_STATUS_FIELD_KEY]: DEFAULT_DEAL_STATUS_VALUE,
    [DEAL_FUNDAE_FIELD_KEY]: '85',
    [DEAL_SERVICE_FIELD_KEY]: DEFAULT_DEAL_SERVICE_VALUE,
    [DEAL_TRAFFIC_SOURCE_FIELD_KEY]: input.trafficSource,
    [DEAL_SOURCE_FIELD_KEY]: DEFAULT_DEAL_SOURCE_TEXT,
    [DEAL_LABEL_FIELD_KEY]: DEFAULT_DEAL_LABEL,
  };

  if (siteOptionId) {
    dealPayload[DEAL_SITE_FIELD_KEY] = siteOptionId;
  }
  if (trainingOptionId) {
    dealPayload[DEAL_TRAINING_FIELD_KEY] = trainingOptionId;
  }

  const deal = await createDeal(dealPayload);

  let productAdded = false;
  if (input.courseName) {
    const product = await resolveProductByCourseName(input.courseName);
    if (product?.id) {
      await addProductToDeal(deal.id, product.id, product.price ?? DEFAULT_FALLBACK_PRODUCT_PRICE);
      productAdded = true;
    } else if (DEFAULT_FALLBACK_PRODUCT_ID.length) {
      warnings.push(`No se ha encontrado un producto exacto para "${input.courseName}". Se usa el producto fallback.`);
      await addProductToDeal(deal.id, DEFAULT_FALLBACK_PRODUCT_ID, DEFAULT_FALLBACK_PRODUCT_PRICE);
      productAdded = true;
    }
  }

  let slackSent = false;
  try {
    await postSlackMessage(DEFAULT_OPEN_CHANNEL_ID, buildOpenSlackMessage(input, input.companyName ?? '—', person.ownerName));
    slackSent = true;
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'No se pudo enviar la notificación a Slack.');
  }

  return {
    webhookEventId: input.webhookEventId,
    category: 'open',
    route: 'open',
    organizationId: organization.id,
    personId: person.id,
    recordId: deal.id,
    recordType: 'deal',
    organizationCreated: organization.created,
    personCreated: person.created,
    recordCreated: true,
    productAdded,
    slackSent,
    warnings,
  };
}

async function processEnterpriseLead(input: NormalizedLeadForm): Promise<LeadFormSyncResult> {
  if (!input.route) {
    throw new Error('No se ha podido identificar la ruta de empresa a partir de la sede del lead.');
  }

  const routeConfig = ENTERPRISE_ROUTES.find((entry) => entry.route === input.route);
  if (!routeConfig) {
    throw new Error('No existe configuración para la ruta de empresa detectada.');
  }

  const warnings: string[] = [];
  const organization = await upsertOrganization(input, DEFAULT_OWNER_ID, routeConfig.searchExact, '59');
  const person = await upsertPerson(input, organization.id, DEFAULT_OWNER_ID, 'Web', 'subscribed');

  const siteOptionId = await resolveOptionId(LEAD_SITE_FIELD_KEY, [input.siteName, ...routeConfig.siteLabelCandidates], getDealFields);
  if (!siteOptionId && input.siteName) {
    warnings.push(`No se ha encontrado la opción de sede para "${input.siteName}".`);
  }

  const trainingOptionId = await resolveOptionId(LEAD_TRAINING_FIELD_KEY, [input.courseName], getDealFields);
  if (!trainingOptionId && input.courseName) {
    warnings.push(`No se ha encontrado la opción de curso para "${input.courseName}".`);
  }

  const leadTitle = `GC - ${input.companyName ?? 'Lead Web'}`;
  const existingLead = await searchLeadByTitle(leadTitle);
  const leadPayload: Record<string, unknown> = {
    title: leadTitle,
    person_id: Number(person.id),
    organization_id: Number(organization.id),
    owner_id: routeConfig.ownerId,
    note: input.observations,
    visible_to: DEFAULT_VISIBLE_TO,
    [LEAD_STATUS_FIELD_KEY]: '63',
    [LEAD_SERVICE_FIELD_KEY]: DEFAULT_DEAL_SERVICE_VALUE,
    [LEAD_TRAFFIC_SOURCE_FIELD_KEY]: input.trafficSource,
    [LEAD_CHANNEL_FIELD_KEY]: DEFAULT_LEAD_SOURCE_VALUE,
  };

  if (siteOptionId) {
    leadPayload[LEAD_SITE_FIELD_KEY] = siteOptionId;
  }
  if (trainingOptionId) {
    leadPayload[LEAD_TRAINING_FIELD_KEY] = trainingOptionId;
  }

  let leadId = existingLead?.id ?? null;
  let created = false;
  let ownerName = person.ownerName;
  if (!leadId) {
    const createdLead = await createLead(leadPayload);
    leadId = createdLead.id;
    created = true;
    ownerName = createdLead.ownerName ?? ownerName;
  } else {
    warnings.push(`Ya existe un lead con el título "${leadTitle}" en Pipedrive. No se crea un duplicado.`);
  }

  let slackSent = false;
  try {
    await postSlackMessage(routeConfig.slackChannelId, buildEnterpriseSlackMessage(input, input.companyName ?? '—', ownerName));
    slackSent = true;
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'No se pudo enviar la notificación a Slack.');
  }

  return {
    webhookEventId: input.webhookEventId,
    category: 'enterprise',
    route: input.route,
    organizationId: organization.id,
    personId: person.id,
    recordId: leadId ?? '',
    recordType: 'lead',
    organizationCreated: organization.created,
    personCreated: person.created,
    recordCreated: created,
    productAdded: false,
    slackSent,
    warnings,
  };
}

export async function sendLeadFormWebhookToPipedrive(params: { prisma: PrismaClient; webhookEventId: string }): Promise<LeadFormSyncResult> {
  const record = await params.prisma.lead_form_webhooks.findUnique({
    where: { id: params.webhookEventId },
    select: {
      id: true,
      source: true,
      request_headers: true,
      payload_json: true,
    },
  });

  if (!record) {
    throw new Error('No se ha encontrado el webhook lead form solicitado.');
  }

  const normalized = normalizeLeadFormFromWebhook(record as { id: string; source: string | null; request_headers: unknown; payload_json: unknown });
  if (!normalized.category) {
    throw new Error('No se ha podido determinar si el lead es de empresa o de formación abierta.');
  }

  if (!normalized.companyName) {
    throw new Error('El webhook no incluye el campo nombre-empresa.');
  }
  if (!normalized.leadName) {
    throw new Error('El webhook no incluye el nombre del lead.');
  }

  if (normalized.category === 'open') {
    return processOpenLead(normalized);
  }

  return processEnterpriseLead(normalized);
}
