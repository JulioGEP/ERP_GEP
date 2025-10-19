import path from 'node:path';
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';

import { errorResponse, preflightResponse, successResponse } from './_shared/response';

const DATA_FILE_PATH = path.resolve(
  process.cwd(),
  'frontend',
  'src',
  'features',
  'informes',
  'utils',
  'plantillas.json',
);

const CUSTOM_TEMPLATE_PREFIX = 'custom-';
const DEFAULT_TEMPLATE_PREFIX = 'default-';

type RawTemplateDefinition = {
  id?: unknown;
  titulo?: unknown;
  title?: unknown;
  duracion?: unknown;
  duration?: unknown;
  teorica?: unknown;
  practica?: unknown;
  name?: unknown;
};

type RawTemplatesRegistry = Record<string, RawTemplateDefinition>;

type TrainingTemplate = {
  id: string;
  name: string;
  title: string;
  duration: string;
  theory: string[];
  practice: string[];
};

type TemplatePayload = {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  duration?: unknown;
  theory?: unknown;
  practice?: unknown;
  mode?: unknown;
};

function normalise(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (entry === null || entry === undefined) {
        return '';
      }
      return String(entry).trim();
    })
    .filter((entry) => entry.length > 0);
}

async function readTemplatesFile(): Promise<{ map: RawTemplatesRegistry; order: string[] }> {
  const raw = await fs.readFile(DATA_FILE_PATH, 'utf8');
  const parsed = JSON.parse(raw) as RawTemplatesRegistry;
  const entries = Object.entries(parsed ?? {});
  const order = entries.map(([key]) => key);
  const map: RawTemplatesRegistry = {};
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    map[key] = value;
  }
  return { map, order };
}

async function writeTemplatesFile(map: RawTemplatesRegistry, order: string[]): Promise<void> {
  const payload: RawTemplatesRegistry = {};
  for (const key of order) {
    if (!key) {
      continue;
    }
    const value = map[key];
    if (!value) {
      continue;
    }
    payload[key] = value;
  }
  const json = JSON.stringify(payload, null, 2);
  await fs.writeFile(DATA_FILE_PATH, `${json}\n`, 'utf8');
}

function toTrainingTemplate(key: string, definition: RawTemplateDefinition): TrainingTemplate | null {
  if (!definition || typeof definition !== 'object') {
    return null;
  }

  const id = toDisplayString((definition as { id?: unknown }).id);
  const storedName = toDisplayString((definition as { name?: unknown }).name);
  const name = storedName || toDisplayString(key);
  const title = toDisplayString((definition as { titulo?: unknown }).titulo ?? (definition as { title?: unknown }).title) || name;
  const duration = toDisplayString((definition as { duracion?: unknown }).duracion ?? (definition as { duration?: unknown }).duration);
  const theory = toStringArray((definition as { teorica?: unknown }).teorica);
  const practice = toStringArray((definition as { practica?: unknown }).practica);

  const resolvedId = id || `${DEFAULT_TEMPLATE_PREFIX}${normalise(title || name).replace(/\s+/g, '-') || 'plantilla'}`;

  return {
    id: resolvedId,
    name,
    title,
    duration,
    theory,
    practice,
  };
}

function ensureUniqueCustomId(existingIds: Set<string>, base: string): string {
  const normalised = normalise(base);
  const slug = normalised.replace(/\s+/g, '-') || 'plantilla';
  let candidate = `${CUSTOM_TEMPLATE_PREFIX}${slug}`;
  let index = 2;
  while (existingIds.has(candidate)) {
    candidate = `${CUSTOM_TEMPLATE_PREFIX}${slug}-${index}`;
    index += 1;
  }
  existingIds.add(candidate);
  return candidate;
}

function ensureUniqueTemplateKey(map: RawTemplatesRegistry, base: string): string {
  const trimmed = toDisplayString(base) || 'Plantilla';
  let candidate = trimmed;
  let index = 2;
  while (map[candidate]) {
    candidate = `${trimmed} (${index})`;
    index += 1;
  }
  return candidate;
}

async function handleListTemplates() {
  const { map, order } = await readTemplatesFile();
  const templates: TrainingTemplate[] = [];
  for (const key of order) {
    const definition = map[key];
    if (!definition) {
      continue;
    }
    const template = toTrainingTemplate(key, definition);
    if (template) {
      templates.push(template);
    }
  }
  return successResponse({ templates });
}

function resolveTemplateKeyById(map: RawTemplatesRegistry, targetId: string): string | null {
  const trimmedId = toDisplayString(targetId);
  if (!trimmedId) {
    return null;
  }
  for (const [key, definition] of Object.entries(map)) {
    if (!definition || typeof definition !== 'object') {
      continue;
    }
    const defId = toDisplayString((definition as { id?: unknown }).id);
    if (defId === trimmedId) {
      return key;
    }
  }
  return null;
}

function resolveTemplateKeyByName(map: RawTemplatesRegistry, targetName: string): string | null {
  const trimmedName = toDisplayString(targetName);
  if (!trimmedName) {
    return null;
  }
  const normalisedTarget = normalise(trimmedName);
  if (!normalisedTarget) {
    return null;
  }

  for (const [key, definition] of Object.entries(map)) {
    if (!definition || typeof definition !== 'object') {
      continue;
    }
    const storedName = toDisplayString((definition as { name?: unknown }).name) || toDisplayString(key);
    if (!storedName) {
      continue;
    }
    const normalisedName = normalise(storedName);
    if (normalisedName === normalisedTarget) {
      return key;
    }
  }

  return null;
}

function applyTemplateChanges(
  map: RawTemplatesRegistry,
  order: string[],
  payload: TemplatePayload,
): { template: TrainingTemplate; map: RawTemplatesRegistry; order: string[] } | { error: ReturnType<typeof errorResponse> } {
  const name = toDisplayString(payload.name);
  const title = toDisplayString(payload.title) || name;
  if (!name) {
    return { error: errorResponse('VALIDATION_ERROR', 'El nombre de la formación es obligatorio.', 400) };
  }
  const duration = toDisplayString(payload.duration);
  const theory = toStringArray(payload.theory);
  const practice = toStringArray(payload.practice);
  const mode = toDisplayString(payload.mode).toLowerCase();
  const allowOverwrite = mode === 'update';
  const existingIds = new Set(
    Object.values(map)
      .map((definition) => (definition && typeof definition === 'object' ? toDisplayString((definition as { id?: unknown }).id) : ''))
      .filter((id) => id.length > 0),
  );

  const providedId = toDisplayString(payload.id);
  let targetKey = providedId ? resolveTemplateKeyById(map, providedId) : null;

  if (!targetKey && allowOverwrite) {
    targetKey = resolveTemplateKeyByName(map, name);
  }

  const nextMap: RawTemplatesRegistry = { ...map };
  const nextOrder = [...order];

  if (!targetKey && !allowOverwrite) {
    const conflictingKey = resolveTemplateKeyByName(map, name);
    if (conflictingKey) {
      return {
        error: errorResponse('VALIDATION_ERROR', 'Ya existe una plantilla con ese nombre.', 400),
      };
    }
  }

  if (targetKey) {
    const currentDefinition = { ...(nextMap[targetKey] ?? {}) } as RawTemplateDefinition;

    currentDefinition.id = providedId || currentDefinition.id || `${DEFAULT_TEMPLATE_PREFIX}${normalise(title || name).replace(/\s+/g, '-') || 'plantilla'}`;
    currentDefinition.titulo = title;
    currentDefinition.name = name;
    if (duration) {
      currentDefinition.duracion = duration;
    } else {
      delete currentDefinition.duracion;
    }
    currentDefinition.teorica = theory;
    currentDefinition.practica = practice;

    nextMap[targetKey] = currentDefinition;

    const template = toTrainingTemplate(targetKey, currentDefinition);
    if (!template) {
      return { error: errorResponse('UNEXPECTED_ERROR', 'No se pudo procesar la plantilla.', 500) };
    }
    return { template, map: nextMap, order: nextOrder };
  }

  const nextKey = ensureUniqueTemplateKey(nextMap, name);

  const generatedId = ensureUniqueCustomId(existingIds, title || name);
  const newDefinition: RawTemplateDefinition = {
    id: generatedId,
    titulo: title,
    teorica: theory,
    practica: practice,
    name,
  };
  if (duration) {
    newDefinition.duracion = duration;
  }
  nextMap[nextKey] = newDefinition;
  nextOrder.push(nextKey);

  const template = toTrainingTemplate(nextKey, newDefinition);
  if (!template) {
    return { error: errorResponse('UNEXPECTED_ERROR', 'No se pudo procesar la plantilla.', 500) };
  }
  return { template, map: nextMap, order: nextOrder };
}

function parsePayload(body: unknown, isBase64Encoded: unknown): TemplatePayload | null {
  if (body === null || body === undefined) {
    return {};
  }

  if (typeof body === 'object' && !Buffer.isBuffer(body)) {
    return body as TemplatePayload;
  }

  if (typeof body !== 'string') {
    return null;
  }

  const rawText = Boolean(isBase64Encoded) ? Buffer.from(body, 'base64').toString('utf8') : body;
  try {
    return JSON.parse(rawText || '{}') as TemplatePayload;
  } catch {
    return null;
  }
}

async function handleSaveTemplate(event: any) {
  const payload = parsePayload(event.body, event.isBase64Encoded);
  if (!payload) {
    return errorResponse('VALIDATION_ERROR', 'Cuerpo de la petición no válido.', 400);
  }
  const { map, order } = await readTemplatesFile();
  const result = applyTemplateChanges(map, order, payload);
  if ('error' in result) {
    return result.error;
  }
  await writeTemplatesFile(result.map, result.order);
  return successResponse({ template: result.template });
}

async function handleDeleteTemplate(event: any) {
  const idFromQuery = toDisplayString(event.queryStringParameters?.id);
  let id = idFromQuery;
  if (!id && event.body) {
    const parsed = parsePayload(event.body, event.isBase64Encoded);
    if (parsed) {
      id = toDisplayString((parsed as { id?: unknown }).id);
    }
  }
  if (!id) {
    return errorResponse('VALIDATION_ERROR', 'Identificador de plantilla no válido.', 400);
  }

  const { map, order } = await readTemplatesFile();
  const targetKey = resolveTemplateKeyById(map, id);
  if (!targetKey) {
    return errorResponse('NOT_FOUND', 'Plantilla no encontrada.', 404);
  }

  const nextMap: RawTemplatesRegistry = { ...map };
  delete nextMap[targetKey];
  const nextOrder = order.filter((key) => key !== targetKey);
  await writeTemplatesFile(nextMap, nextOrder);
  return successResponse({ deleted: true });
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod === 'GET') {
      return await handleListTemplates();
    }

    if (event.httpMethod === 'POST') {
      return await handleSaveTemplate(event);
    }

    if (event.httpMethod === 'DELETE') {
      return await handleDeleteTemplate(event);
    }

    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  } catch (error) {
    console.error('[training-templates] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
