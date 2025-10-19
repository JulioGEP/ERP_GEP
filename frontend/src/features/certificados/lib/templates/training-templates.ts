import rawTemplates from '../../../informes/utils/plantillas.json';

type RawTemplateDefinition = {
  id?: unknown;
  teorica?: unknown;
  practica?: unknown;
  duracion?: unknown;
  duration?: unknown;
  titulo?: unknown;
  title?: unknown;
  name?: unknown;
};

type RawTemplatesRegistry = Record<string, RawTemplateDefinition>;

type ApiTemplate = {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  duration?: unknown;
  theory?: unknown;
  practice?: unknown;
};

export type TrainingTemplate = {
  id: string;
  name: string;
  title: string;
  duration: string;
  theory: string[];
  practice: string[];
};

export type TrainingTemplateInput = {
  id?: string;
  name: string;
  title?: string;
  duration?: string;
  theory?: string[];
  practice?: string[];
};

export type TrainingTemplatesManager = {
  listTemplates(): Promise<TrainingTemplate[]>;
  getTemplateById(id: string): Promise<TrainingTemplate | null>;
  getTrainingDetails(value: string): Promise<TrainingTemplate | null>;
  saveTemplate(input: TrainingTemplateInput): Promise<TrainingTemplate | null>;
  deleteTemplate(id: string): Promise<boolean>;
  createEmptyTemplate(): TrainingTemplate;
  subscribe?(listener: () => void): () => void;
  normaliseName?(value: string): string;
  isCustomTemplateId?(id: string): boolean;
};

const CUSTOM_TEMPLATE_PREFIX = 'custom-';
const rawRegistry: RawTemplatesRegistry = rawTemplates as RawTemplatesRegistry;

function toOptionalString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'string' ? value : String(value);
  return text.trim();
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
      return typeof entry === 'string' ? entry : String(entry);
    })
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cloneTemplate(template: TrainingTemplate): TrainingTemplate {
  return {
    id: template.id,
    name: template.name,
    title: template.title,
    duration: template.duration,
    theory: [...template.theory],
    practice: [...template.practice],
  };
}

function parseRawTemplates(): TrainingTemplate[] {
  const entries = Object.entries(rawRegistry ?? {});
  const templates: TrainingTemplate[] = [];
  entries.forEach(([key, definition]) => {
    if (!definition || typeof definition !== 'object') {
      return;
    }
    const name = toOptionalString(key);
    const title =
      toOptionalString((definition as { titulo?: unknown }).titulo ?? (definition as { title?: unknown }).title) || name;
    const duration = toOptionalString((definition as { duracion?: unknown }).duracion ?? (definition as { duration?: unknown }).duration);
    const theory = toStringArray((definition as { teorica?: unknown }).teorica);
    const practice = toStringArray((definition as { practica?: unknown }).practica);
    const id =
      toOptionalString((definition as { id?: unknown }).id) ||
      `${normaliseName(title || name).replace(/\s+/g, '-') || 'plantilla'}`;
    templates.push({
      id,
      name,
      title,
      duration,
      theory,
      practice,
    });
  });
  return templates;
}

function normaliseApiTemplate(input: ApiTemplate): TrainingTemplate | null {
  const id = toOptionalString(input.id);
  const name = toOptionalString(input.name);
  const title = toOptionalString(input.title) || name;
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    title,
    duration: toOptionalString(input.duration),
    theory: toStringArray(input.theory),
    practice: toStringArray(input.practice),
  };
}

async function fetchTemplatesFromApi(): Promise<TrainingTemplate[] | null> {
  try {
    const response = await fetch('/api/training-templates', {
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`Unexpected status: ${response.status}`);
    }
    const payload = (await response.json()) as { ok?: boolean; templates?: ApiTemplate[] };
    if (!payload?.ok || !Array.isArray(payload.templates)) {
      throw new Error('Respuesta no válida del servidor');
    }
    const templates = payload.templates
      .map((template) => normaliseApiTemplate(template))
      .filter((template): template is TrainingTemplate => Boolean(template));
    return templates;
  } catch (error) {
    console.warn('No se pudo obtener la lista de plantillas desde la API.', error);
    return null;
  }
}

async function persistTemplate(input: TrainingTemplateInput): Promise<TrainingTemplate> {
  const response = await fetch('/api/training-templates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input ?? {}),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'No se pudo guardar la plantilla.');
  }
  const payload = (await response.json()) as { ok?: boolean; template?: ApiTemplate; message?: string };
  if (!payload?.ok || !payload.template) {
    throw new Error(payload?.message || 'No se pudo guardar la plantilla.');
  }
  const template = normaliseApiTemplate(payload.template);
  if (!template) {
    throw new Error('La plantilla devuelta no es válida.');
  }
  return template;
}

async function removeTemplate(id: string): Promise<void> {
  const response = await fetch(`/api/training-templates?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'No se pudo eliminar la plantilla.');
  }
  const payload = (await response.json()) as { ok?: boolean; message?: string };
  if (!payload?.ok) {
    throw new Error(payload?.message || 'No se pudo eliminar la plantilla.');
  }
}

let templatesCache: TrainingTemplate[] | null = parseRawTemplates();
let initialised = false;
const subscribers = new Set<() => void>();

async function ensureInitialised(): Promise<void> {
  if (initialised) {
    return;
  }
  initialised = true;
  const templates = await fetchTemplatesFromApi();
  if (Array.isArray(templates)) {
    templatesCache = templates;
    notifySubscribers();
  }
}

function ensureCache(): TrainingTemplate[] {
  if (!templatesCache) {
    templatesCache = parseRawTemplates();
  }
  return templatesCache;
}

function notifySubscribers(): void {
  subscribers.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('Error al notificar un cambio de plantillas', error);
    }
  });
}

async function listTemplates(): Promise<TrainingTemplate[]> {
  await ensureInitialised();
  return ensureCache().map(cloneTemplate);
}

async function getTemplateById(id: string): Promise<TrainingTemplate | null> {
  await ensureInitialised();
  const trimmed = id?.trim();
  if (!trimmed) {
    return null;
  }
  const match = ensureCache().find((template) => template.id === trimmed);
  return match ? cloneTemplate(match) : null;
}

async function findTemplateByValue(value: string): Promise<TrainingTemplate | null> {
  await ensureInitialised();
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const normalised = normaliseName(trimmed);
  for (const template of ensureCache()) {
    if (template.id === trimmed) {
      return cloneTemplate(template);
    }
  }
  for (const template of ensureCache()) {
    if (template.name.toLowerCase() === lower || template.title.toLowerCase() === lower) {
      return cloneTemplate(template);
    }
  }
  if (normalised.length) {
    for (const template of ensureCache()) {
      if (normaliseName(template.name) === normalised || normaliseName(template.title) === normalised) {
        return cloneTemplate(template);
      }
    }
  }
  return null;
}

async function saveTemplate(input: TrainingTemplateInput): Promise<TrainingTemplate | null> {
  const template = await persistTemplate(input);
  const cache = ensureCache();
  const index = cache.findIndex((entry) => entry.id === template.id);
  if (index >= 0) {
    cache[index] = template;
  } else {
    cache.push(template);
  }
  notifySubscribers();
  return cloneTemplate(template);
}

async function deleteTemplate(id: string): Promise<boolean> {
  const trimmed = id?.trim();
  if (!trimmed) {
    return false;
  }
  await removeTemplate(trimmed);
  const cache = ensureCache();
  const index = cache.findIndex((entry) => entry.id === trimmed);
  if (index >= 0) {
    cache.splice(index, 1);
  }
  notifySubscribers();
  return true;
}

function createEmptyTemplate(): TrainingTemplate {
  return {
    id: '',
    name: '',
    title: '',
    duration: '',
    theory: [],
    practice: [],
  };
}

function isCustomTemplateId(id: string): boolean {
  const trimmed = id?.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.startsWith(CUSTOM_TEMPLATE_PREFIX);
}

const manager: TrainingTemplatesManager = {
  listTemplates,
  getTemplateById,
  getTrainingDetails: findTemplateByValue,
  saveTemplate,
  deleteTemplate,
  createEmptyTemplate,
  subscribe(listener: () => void) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  },
  normaliseName,
  isCustomTemplateId,
};

export function getTrainingTemplatesManager(): TrainingTemplatesManager {
  return manager;
}

export function resetTrainingTemplatesCache(): void {
  templatesCache = parseRawTemplates();
  initialised = false;
}
