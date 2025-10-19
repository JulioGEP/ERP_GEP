import informesPlantillas from '../../../informes/utils/plantillas.json';

(function (global) {
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

  function buildInformeTemplateLookup() {
    const lookup = new Map();
    if (!informesPlantillas || typeof informesPlantillas !== 'object') {
      return lookup;
    }
    Object.entries(informesPlantillas).forEach(([title, content]) => {
      const normalised = normaliseName(title);
      if (!normalised) {
        return;
      }
      const teorica = Array.isArray(content?.teorica) ? [...content.teorica] : [];
      const practica = Array.isArray(content?.practica) ? [...content.practica] : [];
      lookup.set(normalised, {
        title,
        teorica,
        practica
      });
    });
    return lookup;
  }

  function buildCertificateToInformeAliases() {
    const entries = [
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

    const map = new Map();
    entries.forEach(([alias, source]) => {
      const aliasKey = normaliseName(alias);
      const sourceKey = normaliseName(source);
      if (aliasKey && sourceKey) {
        map.set(aliasKey, sourceKey);
      }
    });
    return map;
  }

  function resolveInformeTemplateDetails(name) {
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

  function getDefaultDetailsEntries() {
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

  function normaliseName(value) {
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

  function sanitiseText(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value).trim();
  }

  function sanitiseList(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .map((item) => sanitiseText(item))
      .filter((text) => text !== '');
  }

  function cloneTemplate(template) {
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

  function createCustomId() {
    return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function sanitiseTemplate(template) {
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

    const name = sanitiseText(template.name);
    const title = sanitiseText(template.title) || name;

    return {
      id: template.id ? String(template.id) : '',
      name,
      title,
      duration: sanitiseText(template.duration),
      theory: sanitiseList(template.theory),
      practice: sanitiseList(template.practice)
    };
  }

  function buildDefaultTemplates() {
    const templatesByName = new Map();
    const durationLookup = new Map();

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

  function mergeTemplates(defaultTemplates, customTemplates) {
    const templatesByName = new Map();

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

  function loadCustomTemplates() {
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

  function persistCustomTemplates(customTemplates) {
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

  let customTemplates = loadCustomTemplates();
  let templates = [];
  let sortedTemplates = [];
  let templatesByName = new Map();
  let templatesById = new Map();
  const subscribers = new Set();

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

  function listTemplates() {
    return sortedTemplates.map((template) => cloneTemplate(template));
  }

  function getTemplateByName(name) {
    const normalisedName = normaliseName(name);
    if (!normalisedName) {
      return null;
    }
    const template = templatesByName.get(normalisedName);
    return cloneTemplate(template);
  }

  function getTemplateById(id) {
    if (!id) {
      return null;
    }
    const template = templatesById.get(String(id));
    return cloneTemplate(template);
  }

  function getTrainingDuration(name) {
    const template = getTemplateByName(name);
    return template ? template.duration : '';
  }

  function getTrainingDetails(name) {
    const template = getTemplateByName(name);
    if (!template) {
      return null;
    }
    return {
      theory: [...template.theory],
      practice: [...template.practice]
    };
  }

  function getTrainingTitle(name) {
    const template = getTemplateByName(name);
    if (!template) {
      return sanitiseText(name);
    }
    return template.title || template.name;
  }

  function saveTemplate(template) {
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

  function createEmptyTemplate() {
    return {
      id: '',
      name: '',
      title: '',
      duration: '',
      theory: [],
      practice: []
    };
  }

  function isCustomTemplateId(id) {
    if (!id) {
      return false;
    }
    const stringId = String(id);
    return customTemplates.some((template) => template.id === stringId);
  }

  function deleteTemplate(id) {
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

  function subscribe(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }

  global.trainingTemplates = {
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
})(typeof window !== 'undefined' ? window : this);
