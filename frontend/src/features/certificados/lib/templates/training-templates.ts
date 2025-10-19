import rawTemplates from '../../../informes/utils/plantillas.json';

type RawTemplateDefinition = {
  teorica?: unknown;
  practica?: unknown;
  duracion?: unknown;
  duration?: unknown;
  titulo?: unknown;
  title?: unknown;
  name?: unknown;
};

type RawTemplatesRegistry = Record<string, RawTemplateDefinition>;

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
  listTemplates(): TrainingTemplate[];
  getTemplateById(id: string): TrainingTemplate | null;
  getTrainingDetails(value: string): TrainingTemplate | null;
  saveTemplate(input: TrainingTemplateInput): TrainingTemplate | null;
  deleteTemplate(id: string): boolean;
  createEmptyTemplate(): TrainingTemplate;
  subscribe?(listener: () => void): () => void;
  normaliseName?(value: string): string;
  isCustomTemplateId?(id: string): boolean;
};

const STORAGE_KEY = 'trainingTemplates.custom';
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

const defaultTemplates: TrainingTemplate[] = (() => {
  const entries = Object.entries(rawRegistry ?? {});
  const generatedIds = new Map<string, number>();

  return entries.map(([rawKey, definition], index) => {
    const name = toOptionalString(definition?.name) || toOptionalString(rawKey) || `Plantilla ${index + 1}`;
    const title = toOptionalString(definition?.titulo) || toOptionalString(definition?.title) || name;
    const duration = toOptionalString(definition?.duracion) || toOptionalString(definition?.duration);
    const theory = toStringArray(definition?.teorica);
    const practice = toStringArray(definition?.practica);

    let baseId = normaliseName(title || name);
    if (!baseId.length) {
      baseId = `template-${index + 1}`;
    }
    const usageCount = generatedIds.get(baseId) ?? 0;
    generatedIds.set(baseId, usageCount + 1);
    const id = usageCount === 0 ? baseId : `${baseId}-${usageCount + 1}`;

    return Object.freeze({
      id,
      name,
      title,
      duration,
      theory,
      practice,
    });
  });
})();

const defaultTemplatesMap = new Map(defaultTemplates.map((template) => [template.id, template]));

let customTemplatesCache: TrainingTemplate[] | null = null;

const subscribers = new Set<() => void>();
let storageListenerRegistered = false;

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

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readCustomTemplatesFromStorage(): TrainingTemplate[] {
  if (!hasLocalStorage()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const id = toOptionalString((entry as { id?: unknown }).id);
        const name = toOptionalString((entry as { name?: unknown }).name);
        const title = toOptionalString((entry as { title?: unknown }).title) || name;
        if (!id || !name) {
          return null;
        }
        return {
          id,
          name,
          title,
          duration: toOptionalString((entry as { duration?: unknown }).duration),
          theory: toStringArray((entry as { theory?: unknown }).theory),
          practice: toStringArray((entry as { practice?: unknown }).practice),
        } satisfies TrainingTemplate;
      })
      .filter((template): template is TrainingTemplate => Boolean(template));
  } catch {
    return [];
  }
}

function ensureCustomTemplatesCache(): TrainingTemplate[] {
  if (!customTemplatesCache) {
    customTemplatesCache = readCustomTemplatesFromStorage();
  }
  return customTemplatesCache;
}

function persistCustomTemplates(templates: TrainingTemplate[]): void {
  customTemplatesCache = templates;
  if (hasLocalStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    } catch (error) {
      console.warn('No se pudieron guardar las plantillas personalizadas en el almacenamiento local.', error);
    }
  }
  notifySubscribers();
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

function ensureStorageListener(): void {
  if (storageListenerRegistered || !hasLocalStorage()) {
    return;
  }
  try {
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) {
        customTemplatesCache = null;
        ensureCustomTemplatesCache();
        notifySubscribers();
      }
    });
    storageListenerRegistered = true;
  } catch (error) {
    console.warn('No se pudo registrar el listener de almacenamiento para las plantillas.', error);
  }
}

function listTemplates(): TrainingTemplate[] {
  const custom = ensureCustomTemplatesCache();
  return [...defaultTemplates.map(cloneTemplate), ...custom.map(cloneTemplate)];
}

function getTemplateById(id: string): TrainingTemplate | null {
  const trimmed = id?.trim();
  if (!trimmed) {
    return null;
  }

  const custom = ensureCustomTemplatesCache().find((template) => template.id === trimmed);
  if (custom) {
    return cloneTemplate(custom);
  }

  const defaultTemplate = defaultTemplatesMap.get(trimmed);
  if (defaultTemplate) {
    return cloneTemplate(defaultTemplate);
  }

  const normalised = normaliseName(trimmed);
  if (!normalised.length) {
    return null;
  }

  const fallbackCustom = ensureCustomTemplatesCache().find((template) => normaliseName(template.id) === normalised);
  if (fallbackCustom) {
    return cloneTemplate(fallbackCustom);
  }

  const fallbackDefault = defaultTemplates.find((template) => normaliseName(template.id) === normalised);
  return fallbackDefault ? cloneTemplate(fallbackDefault) : null;
}

function findTemplateByValue(value: string): TrainingTemplate | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const direct = getTemplateById(trimmed);
  if (direct) {
    return direct;
  }

  const lower = trimmed.toLowerCase();
  const normalised = normaliseName(trimmed);

  const candidates = [...defaultTemplates, ...ensureCustomTemplatesCache()];
  for (const template of candidates) {
    if (template.name.toLowerCase() === lower || template.title.toLowerCase() === lower) {
      return cloneTemplate(template);
    }
  }

  if (normalised.length) {
    for (const template of candidates) {
      if (normaliseName(template.name) === normalised || normaliseName(template.title) === normalised) {
        return cloneTemplate(template);
      }
    }
  }

  return null;
}

function createCustomTemplateId(base?: string): string {
  const existingIds = new Set([
    ...defaultTemplates.map((template) => template.id),
    ...ensureCustomTemplatesCache().map((template) => template.id),
  ]);

  const slug = normaliseName(base ?? '');
  const baseId = slug.length ? `${CUSTOM_TEMPLATE_PREFIX}${slug}` : `${CUSTOM_TEMPLATE_PREFIX}${Date.now().toString(36)}`;

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  let candidate = `${baseId}-${index}`;
  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${baseId}-${index}`;
  }
  return candidate;
}

function normaliseTemplateInput(input: TrainingTemplateInput): TrainingTemplate {
  const name = toOptionalString(input.name);
  if (!name.length) {
    throw new Error('El nombre de la formación es obligatorio.');
  }

  const title = toOptionalString(input.title) || name;
  const duration = toOptionalString(input.duration);
  const theory = toStringArray(input.theory);
  const practice = toStringArray(input.practice);

  return {
    id: '',
    name,
    title,
    duration,
    theory,
    practice,
  };
}

function saveTemplate(input: TrainingTemplateInput): TrainingTemplate | null {
  try {
    const normalisedTemplate = normaliseTemplateInput(input);
    const custom = ensureCustomTemplatesCache();
    const trimmedId = toOptionalString(input.id);

    if (trimmedId.length) {
      const index = custom.findIndex((template) => template.id === trimmedId);
      if (index >= 0) {
        normalisedTemplate.id = trimmedId;
        const next = [...custom];
        next[index] = normalisedTemplate;
        persistCustomTemplates(next);
        return cloneTemplate(normalisedTemplate);
      }

      if (!defaultTemplatesMap.has(trimmedId)) {
        normalisedTemplate.id = trimmedId;
        persistCustomTemplates([...custom, normalisedTemplate]);
        return cloneTemplate(normalisedTemplate);
      }
    }

    const candidateBase = normalisedTemplate.name || normalisedTemplate.title;
    normalisedTemplate.id = createCustomTemplateId(candidateBase);
    persistCustomTemplates([...custom, normalisedTemplate]);
    return cloneTemplate(normalisedTemplate);
  } catch (error) {
    console.error('No se pudo guardar la plantilla de formación.', error);
    throw error;
  }
}

function deleteTemplate(id: string): boolean {
  const trimmed = id?.trim();
  if (!trimmed) {
    return false;
  }
  const custom = ensureCustomTemplatesCache();
  const index = custom.findIndex((template) => template.id === trimmed);
  if (index < 0) {
    return false;
  }
  const next = [...custom];
  next.splice(index, 1);
  persistCustomTemplates(next);
  return true;
}

function createEmptyTemplate(): TrainingTemplate {
  return {
    id: createCustomTemplateId(),
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
  if (trimmed.startsWith(CUSTOM_TEMPLATE_PREFIX)) {
    return true;
  }
  return !defaultTemplatesMap.has(trimmed);
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
    ensureStorageListener();
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
  customTemplatesCache = null;
}
