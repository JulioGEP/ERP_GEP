import type { PrismaClient } from '@prisma/client';

import { getDealFields } from './pipedrive';
import { getSlackToken } from './slackConfig';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = Record<string, JsonValue>;

type PipedriveSyncResult = {
  organizationId: string | null;
  personId: string | null;
  leadId: string;
  organizationCreated: boolean;
  personCreated: boolean;
  leadCreated: boolean;
  slackNotified: boolean;
  alreadySynced: boolean;
  warnings: string[];
};

type NormalizedLeadForm = {
  websiteLabel: string;
  companyType: string | null;
  companyName: string | null;
  leadName: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  leadMessage: string | null;
  courseName: string | null;
  siteName: string | null;
  trafficSource: string | null;
  formName: string | null;
  source: string | null;
  serviceName: string | null;
};

type ProductResolution = {
  idPipe: string | null;
  productName: string | null;
  price: number | null;
};

type DealSingleOptionValues = {
  trainingOptionId: string | number | null;
  siteOptionId: string | number | null;
  trainingLookupLabel: string | null;
  siteLookupLabel: string | null;
};

const PIPEDRIVE_BASE_URL = process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
const DEFAULT_PIPE_OWNER_ID = parseIntegerEnv(process.env.LEAD_FORM_PIPE_DEFAULT_OWNER_ID, 13444807);
const DEFAULT_VISIBLE_TO = parseVisibilityEnv(process.env.LEAD_FORM_PIPE_VISIBLE_TO, '7');
const DEFAULT_SLACK_CHANNEL_ID = String(process.env.LEAD_FORM_SLACK_CHANNEL_ID ?? 'C05PBDREZ54').trim();
const OPEN_TRAINING_SLACK_CHANNEL_ID = 'C06P4G70GJD';
const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const DEFAULT_GEP_SERVICES_LEAD_STATUS_VALUE = String(process.env.LEAD_FORM_PIPE_GS_LEAD_STATUS_VALUE ?? '63').trim();
const DEFAULT_GEP_SERVICES_LEAD_SERVICE_VALUE = String(process.env.LEAD_FORM_PIPE_GS_LEAD_SERVICE_VALUE ?? '234').trim();
const DEFAULT_GEP_SERVICES_LEAD_CHANNEL_VALUE = String(process.env.LEAD_FORM_PIPE_GS_LEAD_CHANNEL_VALUE ?? 'Directa').trim();
const DEFAULT_GEP_SERVICES_LEAD_SOURCE_VALUE = String(process.env.LEAD_FORM_PIPE_GS_LEAD_SOURCE_VALUE ?? 'Web').trim();
const LEAD_STATUS_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_STATUS_FIELD_KEY ?? 'ce2c299bd19c48d40297cd7b204780585ab2a5f0').trim();
const LEAD_SERVICE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_SERVICE_FIELD_KEY ?? 'e72120b9e27221b560c8480ff422f3fe28f8dbae').trim();
const LEAD_TRAFFIC_SOURCE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_TRAFFIC_SOURCE_FIELD_KEY ?? 'abfa216589d01466453514fdcfeb1c6e5b9fdf8d').trim();
const LEAD_CHANNEL_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_CHANNEL_FIELD_KEY ?? '35d37547db294a690fb087e3d86b30471f057186').trim();
const LEAD_SOURCE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_SOURCE_FIELD_KEY ?? 'c6eabce7c04f864646aa72c944f875fd71cdf178').trim();
const LEAD_WEB_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_WEB_FIELD_KEY ?? 'bcc13ba7981730831a71700fcd52488f13c2112f').trim();
const LEAD_SERVICE_TYPE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_LEAD_SERVICE_TYPE_FIELD_KEY ?? '1d78d202448ee549a86e0881ec06f3ff7842c5ea').trim();
const DEFAULT_OPEN_TRAINING_PIPELINE_ID = String(process.env.LEAD_FORM_PIPE_OPEN_TRAINING_PIPELINE_ID ?? '3').trim();
const DEFAULT_OPEN_TRAINING_STAGE_ID = String(process.env.LEAD_FORM_PIPE_OPEN_TRAINING_STAGE_ID ?? '13').trim();
const DEAL_SERVICE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_SERVICE_FIELD_KEY ?? 'e72120b9e27221b560c8480ff422f3fe28f8dbae').trim();
const DEAL_TRAINING_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_TRAINING_FIELD_KEY ?? 'c99554c188c3f63ad9bc8b2cf7b50cbd145455ab').trim();
const DEAL_SITE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_SITE_FIELD_KEY ?? '676d6bd51e52999c582c01f67c99a35ed30bf6ae').trim();
const DEAL_STATUS_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_STATUS_FIELD_KEY ?? 'ce2c299bd19c48d40297cd7b204780585ab2a5f0').trim();
const DEAL_FUNDAE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_FUNDAE_FIELD_KEY ?? '245d60d4d18aec40ba888998ef92e5d00e494583').trim();
const DEAL_CAES_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_CAES_FIELD_KEY ?? 'e1971bf3a21d48737b682bf8d864ddc5eb15a351').trim();
const DEAL_TRAFFIC_SOURCE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_TRAFFIC_SOURCE_FIELD_KEY ?? 'abfa216589d01466453514fdcfeb1c6e5b9fdf8d').trim();
const DEAL_SOURCE_FIELD_KEY = String(process.env.LEAD_FORM_PIPE_DEAL_SOURCE_FIELD_KEY ?? 'c6eabce7c04f864646aa72c944f875fd71cdf178').trim();
const DEFAULT_OPEN_TRAINING_SERVICE_VALUE = String(process.env.LEAD_FORM_PIPE_OPEN_TRAINING_SERVICE_VALUE ?? '234').trim();
const DEFAULT_OPEN_TRAINING_STATUS_VALUE = String(process.env.LEAD_FORM_PIPE_OPEN_TRAINING_STATUS_VALUE ?? '64').trim();
const DEFAULT_OPEN_TRAINING_FUNDAE_VALUE = String(process.env.LEAD_FORM_PIPE_OPEN_TRAINING_FUNDAE_VALUE ?? '85').trim();
const DEFAULT_OPEN_TRAINING_CAES_VALUE = String(process.env.LEAD_FORM_PIPE_OPEN_TRAINING_CAES_VALUE ?? '25').trim();
const DEFAULT_OPEN_TRAINING_SOURCE_VALUE = String(process.env.LEAD_FORM_PIPE_OPEN_TRAINING_SOURCE_VALUE ?? 'Lead Web').trim();

type GepServicesRoute = 'bomberos_privados' | 'pci' | 'pau' | 'productos' | 'cesion_material' | 'formacion';

const GEP_SERVICES_ROUTE_LABELS: Record<GepServicesRoute, string[]> = {
  bomberos_privados: ['Bomberos Privados'],
  pci: ['PCI'],
  pau: ['PAU'],
  productos: ['Productos'],
  cesion_material: ['Cesión de Material', 'Cesion de Material'],
  formacion: ['Formación', 'Formacion'],
};

type PipedriveOption = { id?: number | string; label?: string | null; name?: string | null };
type PipedriveField = { key?: string | null; options?: PipedriveOption[] | null };

function parseIntegerEnv(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseVisibilityEnv(rawValue: string | undefined, fallback: '1' | '3' | '5' | '7'): '1' | '3' | '5' | '7' {
  const normalized = String(rawValue ?? '').trim();
  return normalized === '1' || normalized === '3' || normalized === '5' || normalized === '7' ? normalized : fallback;
}

function readString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function readInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function readObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function readArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function pickFirstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return null;
}

function joinNonEmpty(parts: Array<string | null>, separator = ' '): string | null {
  const normalized = parts.map((part) => (part ?? '').trim()).filter((part) => part.length > 0);
  return normalized.length ? normalized.join(separator) : null;
}

function sanitizePhone(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function buildLeadTitle(lead: NormalizedLeadForm): string {
  const primary = lead.companyName ?? lead.leadName ?? lead.leadEmail ?? 'Lead web';
  if (lead.websiteLabel === 'GEP Services') {
    return `GS - ${primary}`;
  }
  return `GEPCO Web - ${primary}`;
}

function buildOpenTrainingDealTitle(lead: NormalizedLeadForm): string {
  const primary = lead.leadName ?? lead.leadEmail ?? lead.leadPhone ?? 'Lead web';
  return `GC- ${primary}`;
}

function normalizeText(value: string | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function includesNormalized(value: string | null, search: string): boolean {
  const normalizedValue = normalizeText(value);
  const normalizedSearch = normalizeText(search);
  return normalizedValue.length > 0 && normalizedSearch.length > 0 && normalizedValue.includes(normalizedSearch);
}

function isOpenTrainingBudgetLead(lead: NormalizedLeadForm): boolean {
  return lead.websiteLabel === 'GEPCO' && includesNormalized(lead.companyType, 'Individual / Autónomo / Particulares');
}

function detectGepServicesRoute(serviceName: string | null): GepServicesRoute | null {
  if (!serviceName) return null;
  if (includesNormalized(serviceName, 'Bomberos Privados')) return 'bomberos_privados';
  if (normalizeText(serviceName) === 'pci') return 'pci';
  if (normalizeText(serviceName) === 'pau') return 'pau';
  if (includesNormalized(serviceName, 'Productos')) return 'productos';
  if (includesNormalized(serviceName, 'Cesión de Material') || includesNormalized(serviceName, 'Cesion de Material')) {
    return 'cesion_material';
  }
  if (includesNormalized(serviceName, 'Formación') || includesNormalized(serviceName, 'Formacion')) return 'formacion';
  return null;
}

function findPipedriveFieldOptions(fields: unknown, fieldKey: string): PipedriveOption[] {
  const collection = readArray<PipedriveField>(fields);
  const field = collection.find((entry) => readString(entry?.key) === fieldKey);
  return readArray<PipedriveOption>(field?.options);
}

function normalizeLookupLabel(value: string | null): string | null {
  if (!value) return null;
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildTrainingLookupCandidates(values: Array<string | null | undefined>): string[] {
  const candidates = new Set<string>();

  for (const value of values) {
    const normalizedValue = readString(value);
    if (!normalizedValue) continue;

    candidates.add(normalizedValue);

    const withoutCursoPrefix = normalizedValue.replace(/^curso\s+/i, '').trim();
    if (withoutCursoPrefix.length) {
      candidates.add(withoutCursoPrefix);
    }

    const withoutCourseTypeSuffix = withoutCursoPrefix
      .replace(/\s+-\s+(empresa|in company|abierta|preventivo)$/i, '')
      .trim();
    if (withoutCourseTypeSuffix.length) {
      candidates.add(withoutCourseTypeSuffix);
    }
  }

  return Array.from(candidates);
}

function toIntegerIdOrNull(value: string | null): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function toPipedriveOptionValue(value: string | null): string | number | null {
  const integerId = toIntegerIdOrNull(value);
  return integerId ?? value;
}

async function resolveSingleOptionId(
  prisma: PrismaClient,
  params: {
    fieldKey: string;
    fieldName: string;
    candidateLabels: Array<string | null | undefined>;
    fallbackLabels?: Array<string | null | undefined>;
  },
): Promise<{ optionId: string | null; matchedLabel: string | null }> {
  const normalizedCandidates = params.candidateLabels
    .map((candidate) => readString(candidate))
    .map((candidate) => normalizeLookupLabel(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));

  const normalizedFallbackCandidates = (params.fallbackLabels ?? [])
    .map((candidate) => readString(candidate))
    .map((candidate) => normalizeLookupLabel(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));

  if (!normalizedCandidates.length && !normalizedFallbackCandidates.length) {
    return { optionId: null, matchedLabel: null };
  }

  const options = await prisma.pipedrive_custom_field_options.findMany({
    where: {
      OR: [
        { field_key: params.fieldKey },
        { field_name: { equals: params.fieldName, mode: 'insensitive' } },
      ],
    },
    select: { option_id: true, option_label: true },
    orderBy: [{ option_order: 'asc' }, { option_label: 'asc' }],
  });

  const matchFromCandidates = (candidates: string[]) =>
    options.find((option) => {
      const normalizedOptionLabel = normalizeLookupLabel(option.option_label);
      return normalizedOptionLabel ? candidates.includes(normalizedOptionLabel) : false;
    });

  const match = matchFromCandidates(normalizedCandidates) ?? matchFromCandidates(normalizedFallbackCandidates);

  return {
    optionId: match?.option_id ?? null,
    matchedLabel: match?.option_label ?? null,
  };
}

function resolvePipedriveOptionId(options: PipedriveOption[], candidateLabels: Array<string | null | undefined>): string | number | null {
  const normalizedCandidates = candidateLabels.map((label) => normalizeText(label ?? null)).filter((label) => label.length > 0);
  if (!normalizedCandidates.length) return null;

  for (const option of options) {
    const optionLabel = normalizeText(readString(option.label) ?? readString(option.name));
    if (optionLabel && normalizedCandidates.includes(optionLabel) && option.id !== undefined && option.id !== null) {
      return option.id;
    }
  }

  for (const option of options) {
    const optionLabel = normalizeText(readString(option.label) ?? readString(option.name));
    if (!optionLabel || option.id === undefined || option.id === null) continue;
    if (normalizedCandidates.some((candidate) => optionLabel.includes(candidate) || candidate.includes(optionLabel))) {
      return option.id;
    }
  }

  return null;
}

async function resolveGepServicesServiceTypeOptionId(lead: NormalizedLeadForm, warnings: string[]): Promise<string | number | null> {
  if (lead.websiteLabel !== 'GEP Services') return null;

  const route = detectGepServicesRoute(lead.serviceName);
  const routeLabels = route ? GEP_SERVICES_ROUTE_LABELS[route] : [];
  const candidateLabels = [lead.serviceName, ...routeLabels].filter((label): label is string => Boolean(readString(label)));

  if (!candidateLabels.length) {
    warnings.push('El lead de GEP Services no incluye un tipo de servicio reconocible.');
    return null;
  }

  const dealFields = await getDealFields();
  const options = findPipedriveFieldOptions(dealFields, LEAD_SERVICE_TYPE_FIELD_KEY);
  if (!options.length) {
    warnings.push('No se han encontrado opciones para el campo de tipo de servicio del lead en Pipedrive.');
    return null;
  }

  const optionId = resolvePipedriveOptionId(options, candidateLabels);
  if (optionId === null) {
    warnings.push(`No se ha encontrado la opción de tipo de servicio para "${lead.serviceName ?? 'sin valor'}".`);
  }

  return optionId;
}

function buildSlackMessage(lead: NormalizedLeadForm, result: PipedriveSyncResult): string {
  if (isOpenTrainingBudgetLead(lead)) {
    return [
      'Nuevo lead de GEPCO.',
      `Empresa: ${lead.companyName ?? '—'}`,
      `Contacto: ${lead.leadName ?? '—'}`,
      `Email: ${lead.leadEmail ?? '—'}`,
      `Teléfono: ${lead.leadPhone ?? '—'}`,
      `Tipo: ${lead.companyType ?? '—'}`,
      `Curso: ${lead.courseName ?? '—'}`,
      `Sede: ${lead.siteName ?? '—'}`,
      `Canal: ${lead.trafficSource ?? '—'}`,
      `Mensaje: ${lead.leadMessage ?? '—'}`,
      `Presupuesto Pipedrive: ${result.leadId}`,
    ].join('\n');
  }

  if (lead.websiteLabel === 'GEPCO') {
    return [
      'Nuevo lead de GEPCO.',
      `Empresa: ${lead.companyName ?? '—'}`,
      `Contacto: ${lead.leadName ?? '—'}`,
      `Email: ${lead.leadEmail ?? '—'}`,
      `Teléfono: ${lead.leadPhone ?? '—'}`,
      `Tipo: ${lead.companyType ?? '—'}`,
      `Curso: ${lead.courseName ?? '—'}`,
      `Sede: ${lead.siteName ?? '—'}`,
      `Canal: ${lead.trafficSource ?? '—'}`,
      `Mensaje: ${lead.leadMessage ?? '—'}`,
    ].join('\n');
  }

  if (lead.websiteLabel === 'GEP Services') {
    return [
      'Nuevo de GEP Services.',
      `Empresa: ${lead.companyName ?? '—'}`,
      `Contacto: ${lead.leadName ?? '—'}`,
      `Email: ${lead.leadEmail ?? '—'}`,
      `Teléfono: ${lead.leadPhone ?? '—'}`,
      `Servicio: ${lead.serviceName ?? '—'}`,
      `Canal: ${lead.trafficSource ?? '—'}`,
      `Mensaje: ${lead.leadMessage ?? '—'}`,
    ].join('\n');
  }

  const lines = [
    `Nuevo lead sincronizado desde ${lead.websiteLabel}.`,
    `Empresa: ${lead.companyName ?? '—'}`,
    `Contacto: ${lead.leadName ?? '—'}`,
    `Email: ${lead.leadEmail ?? '—'}`,
    `Teléfono: ${lead.leadPhone ?? '—'}`,
    `Tipo: ${lead.companyType ?? '—'}`,
    `Curso: ${lead.courseName ?? '—'}`,
    `Sede: ${lead.siteName ?? '—'}`,
    `Canal: ${lead.trafficSource ?? '—'}`,
    `Mensaje: ${lead.leadMessage ?? '—'}`,
    `Prospecto Pipedrive: ${result.leadId}`,
  ];

  if (result.organizationId) {
    lines.push(`Organización Pipedrive: ${result.organizationId}`);
  }
  if (result.personId) {
    lines.push(`Persona Pipedrive: ${result.personId}`);
  }

  return lines.join('\n');
}

function resolveSlackChannelId(lead: NormalizedLeadForm): string {
  if (isOpenTrainingBudgetLead(lead)) {
    return OPEN_TRAINING_SLACK_CHANNEL_ID;
  }
  return DEFAULT_SLACK_CHANNEL_ID;
}

async function postSlackMessage(lead: NormalizedLeadForm, text: string): Promise<void> {
  const token = getSlackToken();
  if (!token.length) {
    throw new Error('No existe la variable SLACK_TOKEN en Netlify.');
  }

  const response = await fetch(SLACK_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: resolveSlackChannelId(lead),
      text,
    }),
  });

  const rawBody = await response.text();
  let payload: { ok?: boolean; error?: string } | null = null;

  try {
    payload = rawBody ? (JSON.parse(rawBody) as { ok?: boolean; error?: string }) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const slackError = payload?.error ? ` (${payload.error})` : '';
    const rawDetails = rawBody ? ` | body=${rawBody}` : '';
    throw new Error(`Slack API chat.postMessage falló${slackError}${rawDetails}`);
  }
}

async function pdRequest(path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: Record<string, unknown> } = {}) {
  const token = String(process.env.PIPEDRIVE_API_TOKEN ?? '').trim();
  if (!token.length) {
    throw new Error('Falta PIPEDRIVE_API_TOKEN en variables de entorno.');
  }

  const url = `${PIPEDRIVE_BASE_URL}${path}${path.includes('?') ? '&' : '?'}api_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const rawBody = await response.text();
  let payload: any = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    const details = rawBody ? ` ${rawBody}` : '';
    throw new Error(`[pipedrive] ${init.method ?? 'GET'} ${path} -> ${response.status}.${details}`);
  }

  return payload;
}

function extractEntityId(entity: unknown): string | null {
  if (entity === null || entity === undefined) return null;
  if (typeof entity === 'string' || typeof entity === 'number') {
    return String(entity).trim() || null;
  }
  if (typeof entity !== 'object') return null;

  const record = entity as Record<string, unknown>;
  return pickFirstText(record.id, record.item_id, record.person_id, record.org_id, record.organization_id, record.lead_id);
}

function extractSearchItems(payload: any): any[] {
  const directItems = readArray(payload?.data?.items);
  if (directItems.length) return directItems;
  const nestedItems = readArray(payload?.data);
  if (nestedItems.length) return nestedItems;
  return [];
}

async function searchOrganizationByName(companyName: string): Promise<any | null> {
  const response = await pdRequest(
    `/organizations/search?term=${encodeURIComponent(companyName)}&fields=name&exact_match=true&limit=10`,
  );
  const items = extractSearchItems(response);
  for (const item of items) {
    const candidate = readObject((item as any)?.item) ?? readObject(item);
    if (!candidate) continue;
    const candidateName = pickFirstText(candidate.name);
    if (candidateName?.localeCompare(companyName, 'es', { sensitivity: 'accent' }) === 0) {
      return candidate;
    }
  }
  return null;
}

function extractPersonEmails(person: any): string[] {
  return readArray(person?.email)
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim().toLowerCase();
      return readString((entry as any)?.value)?.toLowerCase() ?? null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function extractPersonPhones(person: any): string[] {
  return readArray(person?.phone)
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      return readString((entry as any)?.value);
    })
    .filter((entry): entry is string => Boolean(entry));
}


function extractPersonOrganizationId(person: any): string | null {
  const orgValue = person?.org_id;
  if (orgValue === null || orgValue === undefined) return null;
  if (typeof orgValue === 'object') {
    return extractEntityId((orgValue as any)?.value) ?? extractEntityId(orgValue);
  }
  return extractEntityId(orgValue);
}

async function fetchPersonById(personId: string): Promise<any | null> {
  const response = await pdRequest(`/persons/${encodeURIComponent(personId)}`);
  return response?.data ?? null;
}

async function searchPersonByEmailOrPhone(email: string | null, phone: string | null): Promise<any | null> {
  const normalizedEmail = email?.trim().toLowerCase() ?? null;
  if (normalizedEmail) {
    const response = await pdRequest(
      `/persons/search?term=${encodeURIComponent(normalizedEmail)}&fields=email&exact_match=true&limit=10`,
    );
    const items = extractSearchItems(response);
    for (const item of items) {
      const personId = extractEntityId(readObject((item as any)?.item) ?? item);
      if (!personId) continue;
      const person = await fetchPersonById(personId);
      if (extractPersonEmails(person).includes(normalizedEmail)) {
        return person;
      }
    }
  }

  const normalizedPhone = sanitizePhone(phone);
  if (normalizedPhone) {
    const response = await pdRequest(
      `/persons/search?term=${encodeURIComponent(normalizedPhone)}&fields=phone&exact_match=true&limit=10`,
    );
    const items = extractSearchItems(response);
    for (const item of items) {
      const personId = extractEntityId(readObject((item as any)?.item) ?? item);
      if (!personId) continue;
      const person = await fetchPersonById(personId);
      if (extractPersonPhones(person).includes(normalizedPhone)) {
        return person;
      }
    }
  }

  return null;
}

function resolveWebsiteLabel(source: string | null, headers: JsonValue | null | undefined): string {
  const normalizedSource = source?.toLowerCase() ?? '';
  const headerObject = readObject(headers);
  const userAgent = pickFirstText(headerObject?.['user-agent']);

  if (normalizedSource.includes('gepco') || userAgent?.includes('https://gepcoformacion.es') || userAgent?.includes('https://www.gepcoformacion.es')) {
    return 'GEPCO';
  }
  if (normalizedSource.includes('gepservices') || userAgent?.includes('https://gepservices.es') || userAgent?.includes('https://www.gepservices.es')) {
    return 'GEP Services';
  }
  return 'Lead web';
}

function normalizeLeadForm(payloadJson: JsonValue, source: string | null, formName: string | null, headers: JsonValue | null | undefined): NormalizedLeadForm {
  const payload = readObject(payloadJson) ?? {};
  const nestedPayload =
    readObject(payload.payload) ?? readObject(payload.data) ?? readObject(payload.entry) ?? readObject(payload.submission) ?? payload;
  const fields = readObject(nestedPayload.fields) ?? {};
  const websiteLabel = resolveWebsiteLabel(source, headers);

  const leadName =
    joinNonEmpty([
      pickFirstText(nestedPayload.first_name, payload.first_name),
      pickFirstText(nestedPayload.last_name, payload.last_name),
    ]) ??
    pickFirstText(
      nestedPayload['your-name'],
      nestedPayload.name,
      nestedPayload.nombre,
      fields['your-name'],
      fields.name,
      fields.nombre,
      payload['your-name'],
      payload.name,
      payload.nombre,
    );

  return {
    websiteLabel,
    companyType: pickFirstText(nestedPayload['menu-659'], fields['menu-659'], payload['menu-659'], nestedPayload.company_type),
    companyName: pickFirstText(
      nestedPayload['nombre-empresa'],
      fields['nombre-empresa'],
      payload['nombre-empresa'],
      nestedPayload.company,
      nestedPayload.company_name,
      nestedPayload.organization,
      nestedPayload['your-empresa'],
      fields['your-empresa'],
      payload['your-empresa'],
    ),
    leadName,
    leadEmail: pickFirstText(
      nestedPayload['your-email'],
      fields['your-email'],
      payload['your-email'],
      nestedPayload.email,
      nestedPayload.correo,
      fields.email,
    ),
    leadPhone: sanitizePhone(
      pickFirstText(
        nestedPayload['tel-383'],
        fields['tel-383'],
        payload['tel-383'],
        nestedPayload.telefono,
        nestedPayload.phone,
        nestedPayload.telephone,
      ),
    ),
    leadMessage: pickFirstText(
      nestedPayload['your-observaciones'],
      fields['your-observaciones'],
      payload['your-observaciones'],
      nestedPayload['your-message'],
      nestedPayload.message,
      nestedPayload.mensaje,
    ),
    courseName: pickFirstText(
      nestedPayload['uacf7_dynamic_text-116'],
      fields['uacf7_dynamic_text-116'],
      payload['uacf7_dynamic_text-116'],
      nestedPayload.course,
      nestedPayload.product,
    ),
    siteName: pickFirstText(nestedPayload['menu-658'], fields['menu-658'], payload['menu-658'], nestedPayload.site),
    trafficSource: pickFirstText(
      nestedPayload.traffic_source,
      fields.traffic_source,
      payload.traffic_source,
      nestedPayload.utm_source,
    ),
    formName: pickFirstText(formName, nestedPayload.form_name, payload.form_name),
    source,
    serviceName: pickFirstText(
      nestedPayload['menu-541'],
      fields['menu-541'],
      payload['menu-541'],
      nestedPayload.service,
      nestedPayload.servicio,
    ),
  };
}

function buildOrganizationPayload(lead: NormalizedLeadForm) {
  return {
    name: lead.companyName,
    owner_id: DEFAULT_PIPE_OWNER_ID,
    visible_to: DEFAULT_VISIBLE_TO,
  };
}

function buildPersonPayload(lead: NormalizedLeadForm, organizationId: string | null) {
  return {
    name: lead.leadName ?? lead.leadEmail ?? lead.leadPhone ?? 'Lead web',
    owner_id: DEFAULT_PIPE_OWNER_ID,
    visible_to: DEFAULT_VISIBLE_TO,
    org_id: organizationId ?? undefined,
    email: lead.leadEmail ? [{ value: lead.leadEmail, primary: true }] : undefined,
    phone: lead.leadPhone ? [{ value: lead.leadPhone, primary: true }] : undefined,
  };
}

function buildLeadPayload(
  lead: NormalizedLeadForm,
  organizationId: string | null,
  personId: string | null,
  options: { serviceTypeOptionId?: string | number | null } = {},
) {
  const payload: Record<string, unknown> = {
    title: buildLeadTitle(lead),
    owner_id: DEFAULT_PIPE_OWNER_ID,
    visible_to: DEFAULT_VISIBLE_TO,
    person_id: readInteger(personId) ?? undefined,
    organization_id: readInteger(organizationId) ?? undefined,
  };

  if (lead.websiteLabel !== 'GEP Services') {
    return payload;
  }

  payload[LEAD_STATUS_FIELD_KEY] = DEFAULT_GEP_SERVICES_LEAD_STATUS_VALUE;
  payload[LEAD_SERVICE_FIELD_KEY] = DEFAULT_GEP_SERVICES_LEAD_SERVICE_VALUE;
  payload[LEAD_TRAFFIC_SOURCE_FIELD_KEY] = lead.trafficSource ?? undefined;
  payload[LEAD_SOURCE_FIELD_KEY] = DEFAULT_GEP_SERVICES_LEAD_SOURCE_VALUE;
  payload[LEAD_WEB_FIELD_KEY] = DEFAULT_GEP_SERVICES_LEAD_SOURCE_VALUE;
  payload[LEAD_CHANNEL_FIELD_KEY] = DEFAULT_GEP_SERVICES_LEAD_CHANNEL_VALUE;

  if (options.serviceTypeOptionId !== undefined && options.serviceTypeOptionId !== null) {
    payload[LEAD_SERVICE_TYPE_FIELD_KEY] = options.serviceTypeOptionId;
  }

  return payload;
}

function buildOpenTrainingDealPayload(
  lead: NormalizedLeadForm,
  organizationId: string | null,
  personId: string,
  options: DealSingleOptionValues,
) {
  return {
    title: buildOpenTrainingDealTitle(lead),
    status: 'open',
    stage_id: DEFAULT_OPEN_TRAINING_STAGE_ID,
    pipeline_id: DEFAULT_OPEN_TRAINING_PIPELINE_ID,
    user_id: DEFAULT_PIPE_OWNER_ID,
    org_id: readInteger(organizationId) ?? undefined,
    person_id: readInteger(personId) ?? undefined,
    visible_to: DEFAULT_VISIBLE_TO,
    [DEAL_SERVICE_FIELD_KEY]: DEFAULT_OPEN_TRAINING_SERVICE_VALUE,
    [DEAL_SITE_FIELD_KEY]: options.siteOptionId ?? undefined,
    [DEAL_STATUS_FIELD_KEY]: DEFAULT_OPEN_TRAINING_STATUS_VALUE,
    [DEAL_FUNDAE_FIELD_KEY]: DEFAULT_OPEN_TRAINING_FUNDAE_VALUE,
    [DEAL_CAES_FIELD_KEY]: DEFAULT_OPEN_TRAINING_CAES_VALUE,
    [DEAL_TRAFFIC_SOURCE_FIELD_KEY]: lead.trafficSource ?? undefined,
    [DEAL_SOURCE_FIELD_KEY]: DEFAULT_OPEN_TRAINING_SOURCE_VALUE,
    [DEAL_TRAINING_FIELD_KEY]: options.trainingOptionId ?? undefined,
  };
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === 'object' && value !== null && 'toString' in value && typeof (value as { toString: () => string }).toString === 'function') {
    const parsed = Number((value as { toString: () => string }).toString());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

async function resolveOpenTrainingProduct(prisma: PrismaClient, lead: NormalizedLeadForm): Promise<ProductResolution> {
  const courseCandidates = buildTrainingLookupCandidates([lead.courseName]);

  for (const candidate of courseCandidates) {
    const product = await prisma.products.findFirst({
      where: { name: { equals: candidate, mode: 'insensitive' } },
      select: { id_pipe: true, name: true, price: true, variant_price: true },
    });

    if (product?.id_pipe) {
      return {
        idPipe: product.id_pipe,
        productName: product.name ?? lead.courseName,
        price: toNumberOrNull(product.variant_price) ?? toNumberOrNull(product.price),
      };
    }
  }

  return { idPipe: null, productName: lead.courseName, price: null };
}

async function resolveOpenTrainingDealSingleOptionValues(
  prisma: PrismaClient,
  lead: NormalizedLeadForm,
  resolvedProduct: ProductResolution,
): Promise<DealSingleOptionValues> {
  const trainingPrimaryLabel = readString(lead.courseName);
  const trainingLookupCandidates = trainingPrimaryLabel
    ? [trainingPrimaryLabel]
    : buildTrainingLookupCandidates([lead.courseName, resolvedProduct.productName]);
  const trainingFallbackCandidates = trainingPrimaryLabel
    ? buildTrainingLookupCandidates([resolvedProduct.productName, lead.courseName]).filter((candidate) => candidate !== trainingPrimaryLabel)
    : [];
  const trainingLookupLabel = trainingPrimaryLabel ?? trainingLookupCandidates[0] ?? null;
  const siteLookupLabel = readString(lead.siteName);

  const [trainingOption, siteOption] = await Promise.all([
    resolveSingleOptionId(prisma, {
      fieldKey: DEAL_TRAINING_FIELD_KEY,
      fieldName: 'Formación',
      candidateLabels: trainingLookupCandidates,
      fallbackLabels: trainingFallbackCandidates,
    }),
    resolveSingleOptionId(prisma, {
      fieldKey: DEAL_SITE_FIELD_KEY,
      fieldName: 'Sede de la Formación',
      candidateLabels: [siteLookupLabel],
    }),
  ]);

  return {
    trainingOptionId: toPipedriveOptionValue(trainingOption.optionId),
    siteOptionId: toPipedriveOptionValue(siteOption.optionId),
    trainingLookupLabel,
    siteLookupLabel,
  };
}

function buildOpenTrainingDealProductPayload(resolvedProduct: ProductResolution): Record<string, unknown> {
  const normalizedProductId = toIntegerIdOrNull(resolvedProduct.idPipe);
  if (normalizedProductId === null) {
    throw new Error(`El product_id de Pipedrive no es un entero válido: ${resolvedProduct.idPipe ?? 'sin valor'}`);
  }

  return {
    product_id: normalizedProductId,
    item_price: resolvedProduct.price ?? undefined,
    quantity: 1,
    tax_method: 'exclusive',
    is_enabled: true,
  };
}

async function addProductToDeal(dealId: string, payload: Record<string, unknown>): Promise<void> {
  await pdRequest(`/deals/${encodeURIComponent(dealId)}/products`, {
    method: 'POST',
    body: payload,
  });
}

async function createLeadNote(
  leadId: string,
  lead: NormalizedLeadForm,
  personId: string | null,
  organizationId: string | null,
): Promise<void> {
  const body = buildLeadNotePayload(leadId, lead, personId, organizationId);
  if (!body) {
    return;
  }

  await pdRequest('/notes', {
    method: 'POST',
    body,
  });
}

function buildLeadNotePayload(
  leadId: string,
  lead: NormalizedLeadForm,
  personId: string | null,
  organizationId: string | null,
): Record<string, unknown> | null {
  const content = readString(lead.leadMessage);
  if (!content) {
    return null;
  }

  const personNumericId = readInteger(personId);
  const organizationNumericId = readInteger(organizationId);

  return {
    content,
    lead_id: leadId,
    person_id: personNumericId ?? undefined,
    org_id: organizationNumericId ?? undefined,
    pinned_to_lead_flag: 1,
    pinned_to_person_flag: personNumericId ? 1 : undefined,
    pinned_to_organization_flag: organizationNumericId ? 1 : undefined,
  };
}

export const __test__ = {
  readInteger,
  buildLeadPayload,
  buildOpenTrainingDealPayload,
  buildOpenTrainingDealProductPayload,
  buildLeadNotePayload,
  isOpenTrainingBudgetLead,
  parseVisibilityEnv,
  buildSlackMessage,
  resolveSlackChannelId,
};

export async function sendLeadFormToPipedrive(params: {
  prisma: PrismaClient;
  webhookEventId: string;
}): Promise<PipedriveSyncResult> {
  const record = await params.prisma.lead_form_webhooks.findUnique({
    where: { id: params.webhookEventId },
    select: {
      id: true,
      source: true,
      form_name: true,
      request_headers: true,
      payload_json: true,
      pipedrive_organization_id: true,
      pipedrive_person_id: true,
      pipedrive_lead_id: true,
      pipedrive_synced_at: true,
      slack_notified_at: true,
    },
  });

  if (!record) {
    throw new Error('No se ha encontrado el lead solicitado.');
  }

  if (record.pipedrive_lead_id && record.pipedrive_synced_at && record.slack_notified_at) {
    return {
      organizationId: readString(record.pipedrive_organization_id),
      personId: readString(record.pipedrive_person_id),
      leadId: record.pipedrive_lead_id,
      organizationCreated: false,
      personCreated: false,
      leadCreated: false,
      slackNotified: false,
      alreadySynced: true,
      warnings: [],
    };
  }

  const normalized = normalizeLeadForm(record.payload_json as JsonValue, record.source, record.form_name, record.request_headers as JsonValue);
  const warnings: string[] = [];

  if (!normalized.leadName && !normalized.leadEmail && !normalized.leadPhone) {
    throw new Error('El lead no incluye suficiente información de contacto para crear la persona en Pipedrive.');
  }

  let existingOrganization: any | null = null;
  let organizationId: string | null = readString(record.pipedrive_organization_id);
  if (normalized.companyName) {
    existingOrganization = await searchOrganizationByName(normalized.companyName);
    if (existingOrganization) {
      organizationId = extractEntityId(existingOrganization);
    }
  } else {
    warnings.push('El lead no incluye nombre de empresa; se creará el prospecto sin organización vinculada.');
  }

  let organizationCreated = false;
  if (!organizationId && normalized.companyName) {
    const organizationResponse = await pdRequest('/organizations', {
      method: 'POST',
      body: buildOrganizationPayload(normalized),
    });
    organizationId = extractEntityId(organizationResponse?.data ?? organizationResponse);
    organizationCreated = Boolean(organizationId);
  }

  if (normalized.companyName && !organizationId) {
    throw new Error('No se ha podido resolver la organización en Pipedrive.');
  }

  const existingPerson = await searchPersonByEmailOrPhone(normalized.leadEmail, normalized.leadPhone);
  let personId: string | null = readString(record.pipedrive_person_id) ?? extractEntityId(existingPerson);
  let personCreated = false;

  if (personId) {
    const currentPerson = existingPerson ?? (await fetchPersonById(personId));
    const currentOrgId = extractPersonOrganizationId(currentPerson);
    const shouldUpdatePerson = Boolean(
      (!currentOrgId && organizationId) ||
      (normalized.leadPhone && !extractPersonPhones(currentPerson).includes(normalized.leadPhone)) ||
      (normalized.leadEmail && !extractPersonEmails(currentPerson).includes(normalized.leadEmail.toLowerCase())),
    );

    if (shouldUpdatePerson) {
      const response = await pdRequest(`/persons/${encodeURIComponent(personId)}`, {
        method: 'PUT',
        body: buildPersonPayload(normalized, organizationId),
      });
      personId = extractEntityId(response?.data ?? response) ?? personId;
    }
  } else {
    const response = await pdRequest('/persons', {
      method: 'POST',
      body: buildPersonPayload(normalized, organizationId),
    });
    personId = extractEntityId(response?.data ?? response);
    personCreated = Boolean(personId);
  }

  if (!personId) {
    throw new Error('No se ha podido resolver la persona en Pipedrive.');
  }

  let leadId = readString(record.pipedrive_lead_id);
  let leadCreated = false;
  if (!leadId) {
    if (isOpenTrainingBudgetLead(normalized)) {
      const resolvedProduct = await resolveOpenTrainingProduct(params.prisma, normalized);
      const singleOptionValues = await resolveOpenTrainingDealSingleOptionValues(params.prisma, normalized, resolvedProduct);

      if (!resolvedProduct.idPipe) {
        warnings.push('No se ha encontrado el producto de Pipedrive vinculado al curso del lead.');
      }
      if (singleOptionValues.trainingLookupLabel && !singleOptionValues.trainingOptionId) {
        warnings.push(
          `No se ha encontrado la opción de Pipedrive para Formación con el valor "${singleOptionValues.trainingLookupLabel}".`,
        );
      }
      if (singleOptionValues.siteLookupLabel && !singleOptionValues.siteOptionId) {
        warnings.push(
          `No se ha encontrado la opción de Pipedrive para Sede de la Formación con el valor "${singleOptionValues.siteLookupLabel}".`,
        );
      }

      const dealResponse = await pdRequest('/deals', {
        method: 'POST',
        body: buildOpenTrainingDealPayload(normalized, organizationId, personId, singleOptionValues),
      });
      leadId = extractEntityId(dealResponse?.data ?? dealResponse);
      leadCreated = Boolean(leadId);

      if (leadId && resolvedProduct.idPipe) {
        await addProductToDeal(leadId, buildOpenTrainingDealProductPayload(resolvedProduct));
      }
    } else {
      const serviceTypeOptionId = await resolveGepServicesServiceTypeOptionId(normalized, warnings);
      const leadResponse = await pdRequest('/leads', {
        method: 'POST',
        body: buildLeadPayload(normalized, organizationId, personId, { serviceTypeOptionId }),
      });
      leadId = extractEntityId(leadResponse?.data ?? leadResponse);
      leadCreated = Boolean(leadId);

      if (leadId && normalized.websiteLabel === 'GEP Services') {
        await createLeadNote(leadId, normalized, personId, organizationId);
      }
    }
  }

  if (!leadId) {
    throw new Error('No se ha podido crear el prospecto en Pipedrive.');
  }

  const result: PipedriveSyncResult = {
    organizationId,
    personId,
    leadId,
    organizationCreated,
    personCreated,
    leadCreated,
    slackNotified: false,
    alreadySynced: false,
    warnings,
  };

  await postSlackMessage(normalized, buildSlackMessage(normalized, result));
  result.slackNotified = true;

  await params.prisma.lead_form_webhooks.update({
    where: { id: record.id },
    data: {
      pipedrive_organization_id: organizationId,
      pipedrive_person_id: personId,
      pipedrive_lead_id: leadId,
      pipedrive_synced_at: new Date(),
      slack_notified_at: new Date(),
      last_sync_error: null,
    },
  });

  return result;
}
