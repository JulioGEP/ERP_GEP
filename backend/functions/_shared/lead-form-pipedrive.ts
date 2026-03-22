import type { PrismaClient } from '@prisma/client';

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
};

const PIPEDRIVE_BASE_URL = process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
const DEFAULT_PIPE_OWNER_ID = parseIntegerEnv(process.env.LEAD_FORM_PIPE_DEFAULT_OWNER_ID, 13444807);
const DEFAULT_VISIBLE_TO = parseVisibilityEnv(process.env.LEAD_FORM_PIPE_VISIBLE_TO, '7');
const DEFAULT_SLACK_CHANNEL_ID = String(process.env.LEAD_FORM_SLACK_CHANNEL_ID ?? 'C05PBDREZ54').trim();
const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';

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
  return `GEPCO Web - ${primary}`;
}

function buildSlackMessage(lead: NormalizedLeadForm, result: PipedriveSyncResult): string {
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

async function postSlackMessage(text: string): Promise<void> {
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
      channel: DEFAULT_SLACK_CHANNEL_ID,
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

  if (normalizedSource.includes('gepco') || userAgent?.includes('https://gepcoformacion.es')) {
    return 'GEPCO';
  }
  if (normalizedSource.includes('gepservices') || userAgent?.includes('https://gepservices.es')) {
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

function buildLeadPayload(lead: NormalizedLeadForm, organizationId: string | null, personId: string | null) {
  return {
    title: buildLeadTitle(lead),
    owner_id: DEFAULT_PIPE_OWNER_ID,
    visible_to: DEFAULT_VISIBLE_TO,
    person_id: readInteger(personId) ?? undefined,
    organization_id: readInteger(organizationId) ?? undefined,
  };
}

export const __test__ = {
  readInteger,
  buildLeadPayload,
  parseVisibilityEnv,
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
    const leadResponse = await pdRequest('/leads', {
      method: 'POST',
      body: buildLeadPayload(normalized, organizationId, personId),
    });
    leadId = extractEntityId(leadResponse?.data ?? leadResponse);
    leadCreated = Boolean(leadId);
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

  await postSlackMessage(buildSlackMessage(normalized, result));
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
