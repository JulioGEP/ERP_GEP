import informesPlantillas from '../../../informes/utils/plantillas.json';

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
  name?: string;
  title?: string;
  duration?: string;
  theory?: string[];
  practice?: string[];
};

export type TrainingTemplateDetails = {
  theory: string[];
  practice: string[];
};

export type TrainingTemplatesManager = {
  listTemplates: () => TrainingTemplate[];
  getTemplateByName: (name: string) => TrainingTemplate | null;
  getTemplateById: (id: string) => TrainingTemplate | null;
  getTrainingDuration: (name: string) => string;
  getTrainingDetails: (name: string) => TrainingTemplateDetails | null;
  getTrainingTitle: (name: string) => string;
  saveTemplate: (template: TrainingTemplateInput) => TrainingTemplate | null;
  createEmptyTemplate: () => TrainingTemplate;
  deleteTemplate: (id: string) => boolean;
  isCustomTemplateId: (id: string) => boolean;
  subscribe: (callback: () => void) => () => void;
  normaliseName: (value: string) => string;
};

type InformeTemplateLookupValue = {
  title: string;
  teorica: string[];
  practica: string[];
};

type InformeTemplateLookup = Map<string, InformeTemplateLookupValue>;

const globalScope: any = typeof window !== 'undefined' ? window : globalThis;

function createTrainingTemplatesManager(global: any): TrainingTemplatesManager {
  const STORAGE_KEY = 'gep-certificados/training-templates/v1';

  const DEFAULT_DURATION_ENTRIES = [
    ['Pack Emergencias', '6h'],
    ['Trabajos en Altura', '8h'],
    ['Trabajos Verticales', '12h'],
    ['Carretilla elevadora', '8h'],
    ['Espacios Confinados', '8h'],
    ['Operaciones Telco', '6h'],
    ['Riesgo Eléctrico Telco', '6h'],
    ['Espacios Confinados Telco', '6h'],
    ['Trabajos en altura Telco', '6h'],
    ['Basico de Fuego', '4h'],
    ['Avanzado de Fuego', '5h'],
    ['Avanzado y Casa de Humo', '6h'],
    ['Riesgo Químico', '4h'],
    ['Primeros Auxilios', '4h'],
    ['SVD y DEA', '6h'],
    ['Implantación de PAU', '6h'],
    ['Jefes de Emergencias', '8h'],
    ["Curso de ERA's", '8h'],
    ['Andamios', '8h'],
    ['Renovación Bombero de Empresa', '20h'],
    ['Bombero de Empresa Inicial', '350h']
  ];

  const INFORME_TEMPLATE_LOOKUP = buildInformeTemplateLookup();
  const CERTIFICATE_TO_INFORME_ALIASES = buildCertificateToInformeAliases();
  const DEFAULT_DETAILS_SOURCE_NAMES = [
    'Pack Emergencias',
    'Trabajos en Altura',
    'Trabajos Verticales',
    'Carretilla elevadora',
    'Espacios Confinados',
    'Operaciones Telco',
    'Riesgo Eléctrico Telco',
    'Espacios Confinados Telco',
    'Trabajos en altura Telco',
    'Basico de Fuego',
    'Avanzado de Fuego',
    'Avanzado y Casa de Humo',
    'Riesgo Químico',
    'Primeros Auxilios',
    'SVD y DEA',
    'Implantación de PAU',
    'Jefes de Emergencias',
    'Andamios',
    "Curso de ERA's"
  ];

  function buildInformeTemplateLookup(): InformeTemplateLookup {
    const lookup: InformeTemplateLookup = new Map();
    if (!informesPlantillas || typeof informesPlantillas !== 'object') {
      return lookup;
    }
    Object.entries(informesPlantillas).forEach(([title, content]) => {
      const normalised = normaliseName(title);
      if (!normalised) {
        return;
      }
      const teorica = Array.isArray((content as any)?.teorica) ? [...(content as any).teorica] : [];
      const practica = Array.isArray((content as any)?.practica) ? [...(content as any).practica] : [];
      lookup.set(normalised, {
        title,
        teorica,
        practica
      });
    });
    return lookup;
  }

  function buildCertificateToInformeAliases(): Map<string, string> {
    const entries: Array<[string, string]> = [
      ['Pack Emergencias', 'Curso pack emergencias – Extinción de incendios básico y primeros auxilios'],
      ['Trabajos en Altura', 'Curso de Trabajos en Altura'],
      ['Trabajos Verticales', 'Curso de Trabajos Verticales'],
      ['Carretilla elevadora', 'Curso Carretilla Elevadora'],
      ['Andamios', 'Curso montaje y desmontaje de Andamios'],
      ['Operaciones Telco', 'Curso especializado TELCO'],
      ['Riesgo Eléctrico Telco', 'Curso especializado TELCO riesgo eléctrico'],
      ['Espacios Confinados Telco', 'Curso especializado TELCO espacios confinados'],
      ['Trabajos en altura Telco', 'Curso especializado TELCO trabajos en altura'],
      ['Espacios Confinados', 'Curso Espacios Confinados'],
      ['Basico de Fuego', 'Curso de extinción de incendios'],
      ['Avanzado de Fuego', 'Curso avanzado de extinción de incendios'],
      ['Avanzado y Casa de Humo', 'Curso avanzado de extinción de incendios con casa de humo y rescate'],
      ['Riesgo Químico', 'Curso riesgo químico NBQ'],
      ['Primeros Auxilios', 'Curso de Primeros Auxilios'],
      ['SVD y DEA', 'Certificación SVB y DEA (Soporte Vital Básico y Desfibrilador Externo Automático)'],
      ['Implantación de PAU', 'Curso implantación PAU'],
      ['Jefes de Emergencias', 'Curso Jefes de Emergencia e Intervención'],
      ["Curso de ERA's", 'Curso Equipos de Respiración Autónoma (ERA)']
    ];

    const map = new Map<string, string>();
    entries.forEach(([alias, source]) => {
      const aliasKey = normaliseName(alias);
      const sourceKey = normaliseName(source);
      if (aliasKey && sourceKey) {
        map.set(aliasKey, sourceKey);
      }
    });
    return map;
  }

  function resolveInformeTemplateDetails(name: string): {
    title: string;
    theory: string[];
    practice: string[];
  } | null {
    const normalisedName = normaliseName(name);
    if (!normalisedName) {
      return null;
    }
    const lookupKey = CERTIFICATE_TO_INFORME_ALIASES.get(normalisedName) || normalisedName;
    const entry = INFORME_TEMPLATE_LOOKUP.get(lookupKey);
    if (!entry) {
      return null;
    }
    return {
      title: sanitiseText(entry.title),
      theory: sanitiseList(entry.teorica),
      practice: sanitiseList(entry.practica)
    };
  }

  function getDefaultDetailsEntries(): Array<
    [
      string,
      {
        title?: string;
        theory: string[];
        practice: string[];
      }
    ]
  > {
    return DEFAULT_DETAILS_SOURCE_NAMES.map((name) => {
      const resolved = resolveInformeTemplateDetails(name);
      return [
        name,
        {
          title: resolved ? resolved.title : undefined,
          theory: resolved ? resolved.theory : [],
          practice: resolved ? resolved.practice : []
        }
      ];
    });
  }

  function normaliseName(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function sanitiseText(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value).trim();
  }

  function sanitiseList(items: unknown): string[] {
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .map((item) => sanitiseText(item))
      .filter((text) => text !== '');
  }

  function cloneTemplate(template: TrainingTemplate | null | undefined): TrainingTemplate | null {
    if (!template) {
      return null;
    }
    return {
      id: template.id,
      name: template.name,
      title: template.title,
      duration: template.duration,
      theory: [...template.theory],
      practice: [...template.practice]
    };
  }

  function createCustomId(): string {
    return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function sanitiseTemplate(
    template: TrainingTemplateInput | TrainingTemplate | null | undefined
  ): TrainingTemplate {
    if (!template || typeof template !== 'object') {
      return {
        id: '',
        name: '',
        title: '',
        duration: '',
        theory: [],
        practice: []
      };
    }

    const input = template as TrainingTemplateInput;
    const name = sanitiseText(input.name);
    const title = sanitiseText(input.title) || name;

    return {
      id: input.id ? String(input.id) : '',
      name,
      title,
      duration: sanitiseText(input.duration),
      theory: sanitiseList(input.theory),
      practice: sanitiseList(input.practice)
    };
  }

  function buildDefaultTemplates(): TrainingTemplate[] {
    const templatesByName = new Map<string, TrainingTemplate>();
    const durationLookup = new Map<string, string>();

    DEFAULT_DURATION_ENTRIES.forEach(([name, duration]) => {
      const normalisedName = normaliseName(name);
      if (!normalisedName) {
        return;
      }
      const sanitisedDuration = sanitiseText(duration);
      if (sanitisedDuration) {
        durationLookup.set(normalisedName, sanitisedDuration);
      }
      const existing = templatesByName.get(normalisedName) || {
        id: `default-${normalisedName}`,
        name: sanitiseText(name),
        title: sanitiseText(name),
        duration: '',
        theory: [],
        practice: []
      };
      existing.duration = sanitisedDuration;
      templatesByName.set(normalisedName, existing);
    });

    getDefaultDetailsEntries().forEach(([name, details]) => {
      const normalisedName = normaliseName(name);
      if (!normalisedName) {
        return;
      }
      const existing = templatesByName.get(normalisedName) || {
        id: `default-${normalisedName}`,
        name: sanitiseText(name),
        title: sanitiseText(name),
        duration: '',
        theory: [],
        practice: []
      };
      existing.name = sanitiseText(name) || existing.name;
      existing.title = sanitiseText(details && details.title) || existing.name || existing.title;
      existing.theory = sanitiseList(details && details.theory);
      existing.practice = sanitiseList(details && details.practice);
      if (!existing.duration) {
        let matchedDuration = durationLookup.get(normalisedName) || '';
        if (!matchedDuration) {
          for (const [durationKey, durationValue] of durationLookup.entries()) {
            if (durationKey && normalisedName.startsWith(durationKey)) {
              matchedDuration = durationValue;
              break;
            }
          }
        }
        if (matchedDuration) {
          existing.duration = matchedDuration;
        }
      }
      templatesByName.set(normalisedName, existing);
    });

    return Array.from(templatesByName.entries()).map(([key, template]) => {
      const sanitised = sanitiseTemplate(template);
      sanitised.id = template.id || `default-${key}`;
      if (!sanitised.title) {
        sanitised.title = sanitised.name;
      }
      return sanitised;
    });
  }

  function mergeTemplates(
    defaultTemplates: TrainingTemplate[],
    customTemplates: TrainingTemplate[]
  ): TrainingTemplate[] {
    const templatesByName = new Map<string, TrainingTemplate>();

    defaultTemplates.forEach((template) => {
      const normalisedName = normaliseName(template.name);
      if (!normalisedName) {
        return;
      }
      templatesByName.set(normalisedName, {
        ...template,
        id: template.id || `default-${normalisedName}`,
        theory: [...template.theory],
        practice: [...template.practice]
      });
    });

    customTemplates.forEach((template) => {
      const sanitised = sanitiseTemplate(template);
      const normalisedName = normaliseName(sanitised.name);
      if (!normalisedName) {
        return;
      }
      const customId = sanitised.id || createCustomId();
      templatesByName.set(normalisedName, {
        ...sanitised,
        id: customId,
        theory: [...sanitised.theory],
        practice: [...sanitised.practice]
      });
    });

    return Array.from(templatesByName.values());
  }

  function loadCustomTemplates(): TrainingTemplate[] {
    try {
      if (!global.localStorage) {
        return [];
      }
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map((template) => {
        const sanitised = sanitiseTemplate(template);
        if (!sanitised.id) {
          sanitised.id = createCustomId();
        }
        if (!sanitised.title) {
          sanitised.title = sanitised.name;
        }
        return sanitised;
      });
    } catch (error) {
      console.warn('No se han podido cargar las plantillas personalizadas', error);
      return [];
    }
  }

  function persistCustomTemplates(customTemplates: TrainingTemplate[]): void {
    try {
      if (!global.localStorage) {
        return;
      }
      const serialisable = customTemplates.map((template) => ({
        id: template.id,
        name: template.name,
        title: template.title,
        duration: template.duration,
        theory: [...template.theory],
        practice: [...template.practice]
      }));
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(serialisable));
    } catch (error) {
      console.warn('No se han podido guardar las plantillas personalizadas', error);
    }
  }

  let customTemplates: TrainingTemplate[] = loadCustomTemplates();
  let templates: TrainingTemplate[] = [];
  let sortedTemplates: TrainingTemplate[] = [];
  let templatesByName = new Map<string, TrainingTemplate>();
  let templatesById = new Map<string, TrainingTemplate>();
  const subscribers: Set<() => void> = new Set();

  function refreshTemplates() {
    const defaultTemplates = buildDefaultTemplates();
    templates = mergeTemplates(defaultTemplates, customTemplates);

    templatesByName = new Map();
    templatesById = new Map();

    templates.forEach((template) => {
      const normalisedName = normaliseName(template.name);
      const id = template.id ? String(template.id) : '';
      if (normalisedName) {
        templatesByName.set(normalisedName, template);
      }
      if (id) {
        templatesById.set(id, template);
      }
    });

    sortedTemplates = templates
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }

  function notifySubscribers() {
    subscribers.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.error('Error al notificar los cambios de plantillas', error);
      }
    });
  }

  refreshTemplates();

  function listTemplates(): TrainingTemplate[] {
    return sortedTemplates
      .map((template) => cloneTemplate(template))
      .filter((template): template is TrainingTemplate => Boolean(template));
  }

  function getTemplateByName(name: string | null | undefined): TrainingTemplate | null {
    const normalisedName = normaliseName(name);
    if (!normalisedName) {
      return null;
    }
    const template = templatesByName.get(normalisedName);
    return cloneTemplate(template);
  }

  function getTemplateById(id: string | number | null | undefined): TrainingTemplate | null {
    if (!id) {
      return null;
    }
    const template = templatesById.get(String(id));
    return cloneTemplate(template);
  }

  function getTrainingDuration(name: string | null | undefined): string {
    const template = getTemplateByName(name);
    return template ? template.duration : '';
  }

  function getTrainingDetails(name: string | null | undefined): TrainingTemplateDetails | null {
    const template = getTemplateByName(name);
    if (!template) {
      return null;
    }
    return {
      theory: [...template.theory],
      practice: [...template.practice]
    };
  }

  function getTrainingTitle(name: string | null | undefined): string {
    const template = getTemplateByName(name);
    if (!template) {
      return sanitiseText(name);
    }
    return template.title || template.name;
  }

  function saveTemplate(template: TrainingTemplateInput): TrainingTemplate | null {
    const sanitised = sanitiseTemplate(template);
    if (!sanitised.name) {
      throw new Error('El nombre de la formación es obligatorio.');
    }
    if (!sanitised.title) {
      sanitised.title = sanitised.name;
    }
    const normalisedName = normaliseName(sanitised.name);
    if (!normalisedName) {
      throw new Error('El nombre de la formación es obligatorio.');
    }

    if (!sanitised.id) {
      const existing = customTemplates.find((item) => normaliseName(item.name) === normalisedName);
      sanitised.id = existing ? existing.id : createCustomId();
    }

    let stored = false;
    customTemplates = customTemplates.map((item) => {
      if (item.id === sanitised.id) {
        stored = true;
        return { ...sanitised };
      }
      if (normaliseName(item.name) === normalisedName) {
        stored = true;
        return { ...sanitised, id: item.id };
      }
      return item;
    });

    if (!stored) {
      customTemplates.push({ ...sanitised });
    }

    persistCustomTemplates(customTemplates);
    refreshTemplates();
    notifySubscribers();

    return getTemplateById(sanitised.id) || getTemplateByName(sanitised.name);
  }

  function createEmptyTemplate(): TrainingTemplate {
    return {
      id: '',
      name: '',
      title: '',
      duration: '',
      theory: [],
      practice: []
    };
  }

  function isCustomTemplateId(id: string | number | null | undefined): boolean {
    if (!id) {
      return false;
    }
    const stringId = String(id);
    return customTemplates.some((template) => template.id === stringId);
  }

  function deleteTemplate(id: string | number | null | undefined): boolean {
    if (!id) {
      return false;
    }

    const stringId = String(id);
    const templateToRemove = customTemplates.find((template) => template.id === stringId);
    if (!templateToRemove) {
      return false;
    }

    customTemplates = customTemplates.filter((template) => template.id !== stringId);
    persistCustomTemplates(customTemplates);
    refreshTemplates();
    notifySubscribers();

    return true;
  }

  function subscribe(callback: () => void): () => void {
    if (typeof callback !== 'function') {
      return () => {};
    }
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }

  const api: TrainingTemplatesManager = {
    listTemplates,
    getTemplateByName,
    getTemplateById,
    getTrainingDuration,
    getTrainingDetails,
    getTrainingTitle,
    saveTemplate,
    createEmptyTemplate,
    deleteTemplate,
    isCustomTemplateId,
    subscribe,
    normaliseName
  };

  return api;
}

export const trainingTemplatesManager = createTrainingTemplatesManager(globalScope);

export function getTrainingTemplatesManager(): TrainingTemplatesManager {
  return trainingTemplatesManager;
}

if (globalScope && typeof globalScope === 'object') {
  try {
    globalScope.trainingTemplates = trainingTemplatesManager;
  } catch (error) {
    console.warn('No se pudo exponer el gestor de plantillas en la ventana global', error);
  }
}

declare global {
  interface Window {
    trainingTemplates?: TrainingTemplatesManager;
  }
}
