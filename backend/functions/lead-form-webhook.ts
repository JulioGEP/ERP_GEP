import type { Prisma } from '@prisma/client';
import type { Handler } from '@netlify/functions';
import { COMMON_HEADERS } from './_shared/response';
import { getPrisma } from './_shared/prisma';

const WEBHOOK_HEADERS = {
  ...COMMON_HEADERS,
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Source, X-Webhook-Event, X-Forwarded-For, User-Agent',
};

type JsonObject = Record<string, unknown>;

type LeadFormSummary = {
  source: string | null;
  eventName: string | null;
  formName: string | null;
  entryId: string | null;
  leadName: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  leadMessage: string | null;
  requestHeaders: Record<string, string>;
  payloadJson: JsonObject;
};

function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: WEBHOOK_HEADERS,
    body: JSON.stringify(body),
  };
}

function normalizeHeaders(headers: Parameters<Handler>[0]['headers']): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (!key || value === undefined || value === null) continue;
    normalized[key.toLowerCase()] = String(value);
  }
  return normalized;
}

function decodeBody(event: Parameters<Handler>[0]): string | null {
  if (event.body === undefined || event.body === null) {
    return null;
  }

  const value = typeof event.body === 'string' ? event.body : String(event.body);
  if (!event.isBase64Encoded) {
    return value;
  }

  return Buffer.from(value, 'base64').toString('utf8');
}

function parseBody(rawBody: string | null): JsonObject {
  if (!rawBody) {
    return {};
  }

  const trimmed = rawBody.trim();
  if (!trimmed.length) {
    return {};
  }

  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('INVALID_JSON_OBJECT');
  }

  return parsed as JsonObject;
}

function readString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function readNestedObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function pickFirstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return null;
}

function joinName(...values: Array<string | null>): string | null {
  const parts = values.map((value) => value?.trim() ?? '').filter((value) => value.length > 0);
  return parts.length ? parts.join(' ') : null;
}

function normalizeSourceFromQuery(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    return pickFirstText(url.searchParams.get('source'), url.searchParams.get('site'), url.searchParams.get('web'));
  } catch {
    return null;
  }
}

function resolvePayload(body: JsonObject): JsonObject {
  const nestedCandidates = [body.payload, body.data, body.entry, body.submission];
  for (const candidate of nestedCandidates) {
    const nested = readNestedObject(candidate);
    if (nested) {
      return nested;
    }
  }
  return body;
}

function resolveSource(body: JsonObject, headers: Record<string, string>, rawUrl: string | undefined): string | null {
  return pickFirstText(
    normalizeSourceFromQuery(rawUrl),
    headers['x-webhook-source'],
    body.source,
    body.site,
    body.web,
    body.origin,
    body.website,
    body.domain,
    body.home_url,
  );
}

function resolveEventName(body: JsonObject, headers: Record<string, string>): string | null {
  return pickFirstText(
    headers['x-webhook-event'],
    body.event,
    body.topic,
    body.action,
    body.type,
    'lead_form_submission',
  );
}

function buildLeadSummary(body: JsonObject, headers: Record<string, string>, rawUrl: string | undefined): LeadFormSummary {
  const payload = resolvePayload(body);
  const contact = readNestedObject(payload.contact) ?? readNestedObject(payload.lead) ?? readNestedObject(payload.fields);

  return {
    source: resolveSource(body, headers, rawUrl),
    eventName: resolveEventName(body, headers),
    formName: pickFirstText(
      payload.form_name,
      payload.formName,
      payload.title,
      payload.form_title,
      body.form_name,
      body.formName,
      body.title,
      body._wpcf7_title,
      body['form-title'],
    ),
    entryId: pickFirstText(
      payload.entry_id,
      payload.entryId,
      payload.submission_id,
      payload.id,
      body.entry_id,
      body.entryId,
      body.submission_id,
      body.id,
    ),
    leadName:
      joinName(pickFirstText(contact?.first_name, payload.first_name, body.first_name), pickFirstText(contact?.last_name, payload.last_name, body.last_name)) ??
      pickFirstText(
        contact?.name,
        contact?.nombre,
        payload.name,
        payload.nombre,
        payload.full_name,
        payload['your-name'],
        payload['nombre-apellidos'],
        body.name,
        body.nombre,
        body.full_name,
        body['your-name'],
        body['nombre-apellidos'],
      ),
    leadEmail: pickFirstText(
      contact?.email,
      contact?.correo,
      payload.email,
      payload.correo,
      payload['your-email'],
      body.email,
      body.correo,
      body['your-email'],
    ),
    leadPhone: pickFirstText(
      contact?.phone,
      contact?.telefono,
      payload.phone,
      payload.telefono,
      payload.telephone,
      payload['your-phone'],
      body.phone,
      body.telefono,
      body.telephone,
      body['your-phone'],
    ),
    leadMessage: pickFirstText(
      contact?.message,
      contact?.mensaje,
      payload.message,
      payload.mensaje,
      payload.comments,
      payload['your-message'],
      body.message,
      body.mensaje,
      body.comments,
      body['your-message'],
    ),
    requestHeaders: headers,
    payloadJson: body,
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: WEBHOOK_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, {
      ok: false,
      error_code: 'METHOD_NOT_ALLOWED',
      message: 'Método no permitido.',
    });
  }

  const rawBody = decodeBody(event);
  let body: JsonObject;
  try {
    body = parseBody(rawBody);
  } catch (error) {
    console.error('[lead-form-webhook] Invalid JSON payload', error);
    return jsonResponse(400, {
      ok: false,
      error_code: 'INVALID_JSON',
      message: 'El cuerpo debe ser un JSON válido.',
    });
  }

  const headers = normalizeHeaders(event.headers);
  const summary = buildLeadSummary(body, headers, event.rawUrl);

  try {
    const prisma = getPrisma();
    const record = await prisma.lead_form_webhooks.create({
      data: {
        source: summary.source,
        event_name: summary.eventName,
        form_name: summary.formName,
        entry_id: summary.entryId,
        lead_name: summary.leadName,
        lead_email: summary.leadEmail,
        lead_phone: summary.leadPhone,
        lead_message: summary.leadMessage,
        request_headers: summary.requestHeaders as Prisma.InputJsonValue,
        payload_json: summary.payloadJson as Prisma.InputJsonValue,
      },
    });

    return jsonResponse(200, {
      ok: true,
      message: 'Webhook procesado correctamente.',
      eventId: record.id,
    });
  } catch (error) {
    console.error('[lead-form-webhook] Failed to persist webhook', error);
    return jsonResponse(500, {
      ok: false,
      error_code: 'PERSISTENCE_ERROR',
      message: 'No se pudo guardar el webhook.',
    });
  }
};
