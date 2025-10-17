import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Button, Card, Form, Modal, Spinner } from 'react-bootstrap';

import {
  ApiError,
  createSessionPublicLink,
  fetchSessionPublicLink,
  uploadSessionCertificate,
  type SessionPublicLink,
} from '../presupuestos/api';
import { useCertificateData } from './hooks/useCertificateData';
import { CertificateTable } from './CertificateTable';
import { CertificateToolbar, type CertificateToolbarProgressStatus } from './CertificateToolbar';
import type { CertificateRow, CertificateSession } from './lib/mappers';
import type { DealDetail } from '../../types/deal';
import {
  generateCertificatePDF,
  generateCertificateTemplatePreviewDataUrl,
  type CertificateGenerationData,
} from './pdf/generator';
import { pdfMakeReady } from './lib/pdf/pdfmake-initializer';

import './lib/templates/training-templates';

import './styles/certificados.scss';

const CERTIFICATES_STORAGE_KEY = 'certificadosState';

type TrainingTemplate = {
  id: string;
  name: string;
  title: string;
  duration: string;
  theory: string[];
  practice: string[];
};

type TrainingTemplatesApi = {
  listTemplates: () => TrainingTemplate[];
  getTemplateById?: (id: string) => TrainingTemplate | null;
  getTemplateByName?: (name: string) => TrainingTemplate | null;
  subscribe?: (callback: () => void) => () => void;
  normaliseName?: (name: string) => string;
};

type CertificateTemplateOption = {
  key: string;
  label: string;
  template: TrainingTemplate;
};

declare global {
  interface Window {
    trainingTemplates?: TrainingTemplatesApi;
  }
}

type PersistedCertificatePageState = {
  dealIdInput?: string;
  selectedSessionId?: string | null;
  editableRows?: CertificateRow[];
  selectedTemplateKey?: string;
  templateSelectionManuallyChanged?: boolean;
  excludedCertifiedIds?: string[];
};

function resolveTrainingTemplatesApi(): TrainingTemplatesApi | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.trainingTemplates ?? null;
}

function defaultNormaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normaliseTemplateKey(value: string, api: TrainingTemplatesApi | null): string {
  if (!value.trim().length) {
    return '';
  }
  if (api && typeof api.normaliseName === 'function') {
    try {
      const normalised = api.normaliseName(value);
      if (typeof normalised === 'string' && normalised.trim().length > 0) {
        return normalised.trim();
      }
    } catch {
      // Ignored: fall back to default normalisation.
    }
  }
  return defaultNormaliseName(value);
}

function findMatchingTemplateOption(
  options: CertificateTemplateOption[],
  candidate: string,
  api: TrainingTemplatesApi | null,
): CertificateTemplateOption | null {
  const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
  if (!trimmed.length) {
    return null;
  }

  const candidateValues = new Set<string>();
  candidateValues.add(trimmed);

  if (api && typeof api.getTemplateById === 'function') {
    try {
      const template = api.getTemplateById(trimmed);
      if (template) {
        const id = typeof template.id === 'string' ? template.id.trim() : '';
        const name = typeof template.name === 'string' ? template.name.trim() : '';
        const title = typeof template.title === 'string' ? template.title.trim() : '';
        if (id) candidateValues.add(id);
        if (name) candidateValues.add(name);
        if (title) candidateValues.add(title);
      }
    } catch {
      // Ignorado: el ID no se pudo resolver en una plantilla conocida.
    }
  }

  for (const value of candidateValues) {
    const directMatch = options.find((option) => {
      if (option.key === value) {
        return true;
      }
      const optionId =
        typeof option.template?.id === 'string' ? option.template.id.trim() : '';
      return optionId === value;
    });
    if (directMatch) {
      return directMatch;
    }
  }

  for (const value of candidateValues) {
    const normalisedCandidate = normaliseTemplateKey(value, api);
    if (!normalisedCandidate) {
      continue;
    }
    const normalisedMatch = options.find((option) => {
      if (normaliseTemplateKey(option.key, api) === normalisedCandidate) {
        return true;
      }
      const optionId =
        typeof option.template?.id === 'string' ? option.template.id.trim() : '';
      if (!optionId) {
        return false;
      }
      return normaliseTemplateKey(optionId, api) === normalisedCandidate;
    });
    if (normalisedMatch) {
      return normalisedMatch;
    }
  }

  return null;
}

function toTemplateOption(template: TrainingTemplate): CertificateTemplateOption | null {
  const name = typeof template.name === 'string' ? template.name.trim() : '';
  const title = typeof template.title === 'string' ? template.title.trim() : '';
  if (!name.length && !title.length) {
    return null;
  }
  const key = name.length ? name : title;
  const label = title.length ? title : name;
  return {
    key,
    label,
    template: {
      ...template,
      id: template.id ?? '',
      name,
      title,
      duration: typeof template.duration === 'string' ? template.duration.trim() : '',
      theory: Array.isArray(template.theory) ? template.theory.slice() : [],
      practice: Array.isArray(template.practice) ? template.practice.slice() : [],
    },
  };
}

function toTrimmedString(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseHoursValue(value?: string | number | null): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const normalised = value.replace(',', '.').trim();
    if (!normalised.length) {
      return null;
    }
    const parsed = Number(normalised);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function normaliseSessionDate(value?: string | null): string {
  const trimmed = toTrimmedString(value);
  if (!trimmed.length) {
    return '';
  }

  const directDate = new Date(trimmed);
  if (!Number.isNaN(directDate.getTime())) {
    return trimmed;
  }

  const match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return trimmed;
}

function normaliseLocationKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function resolveCertificateLocation(value: string): string {
  if (!value.trim().length) {
    return value;
  }

  const trimmedValue = value.trim();
  const normalisedValue = normaliseLocationKey(trimmedValue);

  if (normalisedValue === 'in company') {
    return 'sus instalaciones';
  }

  const postalCodeMatch = trimmedValue.match(/\b\d{5}\s+([^,]+)/);
  if (postalCodeMatch) {
    return postalCodeMatch[1].trim();
  }

  return trimmedValue;
}

function mapRowToCertificateGenerationData(
  row: CertificateRow,
  context: { deal: DealDetail | null; session: CertificateSession | null },
): CertificateGenerationData {
  const nombre = toTrimmedString(row.nombre);
  const apellido = toTrimmedString(row.apellidos);
  const dni = toTrimmedString(row.dni);
  const sessionDate = normaliseSessionDate(context.session?.fecha_inicio_utc ?? row.fecha);
  const sede = resolveCertificateLocation(toTrimmedString(context.deal?.sede_label ?? row.lugar));
  const productName = toTrimmedString(context.session?.productName ?? row.formacion);
  const hours =
    parseHoursValue(context.session?.productHours ?? null) ?? parseHoursValue(row.horas ?? null);

  if (!sessionDate) {
    throw new Error('Falta la fecha de la sesión para generar el certificado.');
  }

  if (!sede) {
    throw new Error('Falta la sede para generar el certificado.');
  }

  if (!productName) {
    throw new Error('Falta la formación para generar el certificado.');
  }

  if (hours === null || hours <= 0) {
    throw new Error('Faltan las horas de la formación para generar el certificado.');
  }

  return {
    alumno: {
      nombre,
      apellido,
      dni,
    },
    sesion: {
      fecha_inicio_utc: sessionDate,
    },
    deal: {
      sede_labels: sede,
    },
    producto: {
      name: productName,
      hours,
    },
  };
}

function slugifyForFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function sanitizeFileNamePart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s\-_.]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDateForFileName(value?: string | null): string | null {
  const trimmed = toTrimmedString(value);
  if (!trimmed.length) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  const match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const fallback = slugifyForFileName(trimmed);
  return fallback.length ? fallback : null;
}

function buildCertificateFileName(row: CertificateRow, session: CertificateSession | null): string {
  const productName = sanitizeFileNamePart(
    toTrimmedString(session?.productName ?? row.formacion),
  );
  const sessionDate = formatDateForFileName(session?.fecha_inicio_utc ?? row.fecha) ?? '';
  const sedeLabel = sanitizeFileNamePart(toTrimmedString(row.lugar));

  const parts = ['Certificado'];
  if (productName) {
    parts.push(productName);
  }
  if (sessionDate) {
    parts.push(sessionDate);
  }
  if (sedeLabel) {
    parts.push(sedeLabel);
  }

  const fileName = parts.join(' ').replace(/\s+/g, ' ').trim() || 'Certificado';
  return `${fileName}.pdf`;
}

const CERTIFICATE_BATCH_SIZE = 5;
const CERTIFICATE_MAX_RETRIES = 3;
const CERTIFICATE_RETRY_DELAY_MS = 500;

type GenerationFailureStage = 'generate' | 'upload';

type GenerationResult = {
  id: string;
  label: string;
  status: 'success' | 'error';
  message?: string | null;
  stage?: GenerationFailureStage;
  url?: string | null;
};

type GenerationStepStatus = CertificateToolbarProgressStatus;
type GenerationStepId =
  | 'loadGenerator'
  | 'generatePdf'
  | 'uploadCertificates'
  | 'refreshStudents';

type GenerationStep = {
  id: GenerationStepId;
  label: string;
  status: GenerationStepStatus;
};

type GenerationStepDefinition = Pick<GenerationStep, 'id' | 'label'>;

const GENERATION_STEP_DEFINITIONS: GenerationStepDefinition[] = [
  { id: 'loadGenerator', label: 'Preparando generador de certificados' },
  { id: 'generatePdf', label: 'Generando certificados (PDF)' },
  { id: 'uploadCertificates', label: 'Subiendo certificados' },
  { id: 'refreshStudents', label: 'Actualizando listado de alumnos' },
];

class GenerationCancelledError extends Error {
  constructor() {
    super('Generación de certificados cancelada por el usuario.');
    this.name = 'GenerationCancelledError';
  }
}

function createGenerationSteps(): GenerationStep[] {
  return GENERATION_STEP_DEFINITIONS.map((definition) => ({
    ...definition,
    status: 'pending',
  }));
}

function wait(delay: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

const SESSION_DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatSessionDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return SESSION_DATE_FORMATTER.format(date);
}

function buildSessionLabel(session: CertificateSession): string {
  const parts: string[] = [];
  const date = formatSessionDate(session.fecha_inicio_utc);
  if (date) parts.push(date);
  if (session.nombre_cache) parts.push(session.nombre_cache);
  if (session.productName) parts.push(session.productName);
  return parts.join(' · ');
}

function buildStudentDisplayName(row: CertificateRow): string {
  const name = row.nombre?.trim() ?? '';
  const surname = row.apellidos?.trim() ?? '';
  const fullName = `${name} ${surname}`.trim();
  if (fullName.length) {
    return fullName;
  }
  const dni = row.dni?.trim();
  if (dni?.length) {
    return dni;
  }
  return 'Alumno/a sin identificar';
}

function isRowComplete(row: CertificateRow): boolean {
  return Boolean(row.nombre?.trim()) && Boolean(row.apellidos?.trim()) && Boolean(row.dni?.trim());
}

function toNonEmptyString(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function resolveSessionPublicLinkUrl(link: SessionPublicLink | null): string | null {
  if (!link) {
    return null;
  }
  const directUrl = toNonEmptyString(link.public_url ?? null);
  if (directUrl) {
    return directUrl;
  }
  const publicPath = toNonEmptyString(link.public_path ?? null);
  if (!publicPath) {
    return null;
  }
  if (typeof window !== 'undefined' && publicPath.startsWith('/')) {
    return `${window.location.origin}${publicPath}`;
  }
  return publicPath;
}

function resolveGenerationError(error: unknown): string {
  if (error instanceof ApiError) {
    const codeLabel = error.code ? `[${error.code}] ` : '';
    return `${codeLabel}${error.message}`.trim();
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length) {
    return error.trim();
  }
  return 'Ha ocurrido un error inesperado al generar los certificados.';
}

export function CertificadosPage() {
  const [dealIdInput, setDealIdInput] = useState('');
  const {
    deal,
    sessions,
    selectedSession,
    selectedSessionId,
    rows,
    loadingDeal,
    loadingStudents,
    dealError,
    studentsError,
    loadDealAndSessions,
    selectSession,
    resetAll: resetCertificateData,
  } = useCertificateData();

  const [editableRows, setEditableRows] = useState<CertificateRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationTotal, setGenerationTotal] = useState(0);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationResults, setGenerationResults] = useState<GenerationResult[]>([]);
  const [generationSteps, setGenerationSteps] = useState<GenerationStep[]>(() => createGenerationSteps());
  const [isCancellingGeneration, setIsCancellingGeneration] = useState(false);
  const generationAbortRef = useRef<{ cancelled: boolean } | null>(null);
  const [publicLinkUrl, setPublicLinkUrl] = useState<string | null>(null);
  const [publicLinkLoading, setPublicLinkLoading] = useState(false);
  const [publicLinkError, setPublicLinkError] = useState<string | null>(null);
  const publicLinkRequestIdRef = useRef(0);
  const [excludedCertifiedIds, setExcludedCertifiedIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [showCertifiedWarning, setShowCertifiedWarning] = useState(false);
  const suppressCertifiedWarningRef = useRef(false);
  const hasLoadedPersistedStateRef = useRef(false);
  const pendingPersistedSessionRef = useRef<string | null>(null);
  const pendingPersistedRowsRef = useRef<CertificateRow[] | null>(null);
  const pendingPersistedExcludedIdsRef = useRef<string[] | null>(null);
  const pendingTemplateManualRef = useRef<boolean | null>(null);
  const pendingPersistedTemplateKeyRef = useRef<string | null>(null);

  const templateSelectionManuallyChangedRef = useRef(false);
  const [templateSelectionManuallyChangedState, setTemplateSelectionManuallyChangedState] =
    useState(false);
  const setTemplateSelectionManuallyChanged = useCallback((value: boolean) => {
    templateSelectionManuallyChangedRef.current = value;
    setTemplateSelectionManuallyChangedState(value);
  }, []);

  const [templateOptions, setTemplateOptions] = useState<CertificateTemplateOption[]>([]);
  const trainingTemplatesApiRef = useRef<TrainingTemplatesApi | null>(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('');
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState<string | null>(null);
  const [loadingTemplatePreview, setLoadingTemplatePreview] = useState(false);
  const [templatePreviewError, setTemplatePreviewError] = useState<string | null>(null);

  useEffect(() => {
    const api = resolveTrainingTemplatesApi();
    trainingTemplatesApiRef.current = api;

    if (!api) {
      setTemplateOptions([]);
      return;
    }

    const updateOptions = () => {
      try {
        const list = api.listTemplates();
        const optionsMap = new Map<string, CertificateTemplateOption>();
        list.forEach((template) => {
          const option = toTemplateOption(template);
          if (!option) {
            return;
          }
          const normalised = normaliseTemplateKey(option.key, api);
          if (!normalised) {
            return;
          }
          if (!optionsMap.has(normalised)) {
            optionsMap.set(normalised, option);
            return;
          }

          const existing = optionsMap.get(normalised);
          if (!existing) {
            optionsMap.set(normalised, option);
            return;
          }

          const existingLabel = existing.label.trim();
          const candidateLabel = option.label.trim();
          if (!existingLabel && candidateLabel) {
            optionsMap.set(normalised, option);
          }
        });
        const options = Array.from(optionsMap.values()).sort((a, b) =>
          a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }),
        );
        setTemplateOptions(options);
      } catch (error) {
        console.error('No se pudieron cargar las plantillas de certificados', error);
        setTemplateOptions([]);
      }
    };

    updateOptions();

    let unsubscribe: (() => void) | undefined;
    if (typeof api.subscribe === 'function') {
      try {
        unsubscribe = api.subscribe(() => {
          updateOptions();
        });
      } catch (error) {
        console.warn('No se pudo suscribir a los cambios de plantillas', error);
      }
    }

    return () => {
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch (error) {
          console.warn('Error al cancelar la suscripción de plantillas', error);
        }
      }
    };
  }, []);

  const resetGenerationSteps = useCallback(() => {
    setGenerationSteps(createGenerationSteps());
  }, [setGenerationSteps]);

  const ensureSessionPublicLink = useCallback(
    async (options?: { forceCreate?: boolean }) => {
      const dealId = deal?.deal_id ? String(deal.deal_id).trim() : '';
      const sessionId = selectedSessionId ? String(selectedSessionId).trim() : '';

      if (!dealId || !sessionId) {
        publicLinkRequestIdRef.current += 1;
        setPublicLinkUrl(null);
        setPublicLinkError(null);
        setPublicLinkLoading(false);
        return;
      }

      const requestId = ++publicLinkRequestIdRef.current;
      setPublicLinkLoading(true);
      setPublicLinkError(null);

      try {
        let link = await fetchSessionPublicLink(dealId, sessionId);
        if (!link && options?.forceCreate) {
          link = await createSessionPublicLink(dealId, sessionId);
        }

        if (publicLinkRequestIdRef.current !== requestId) {
          return;
        }

        if (link) {
          setPublicLinkUrl(resolveSessionPublicLinkUrl(link));
        } else {
          setPublicLinkUrl(null);
        }
      } catch (error) {
        if (publicLinkRequestIdRef.current !== requestId) {
          return;
        }
        setPublicLinkUrl(null);
        setPublicLinkError(resolveGenerationError(error));
      } finally {
        if (publicLinkRequestIdRef.current === requestId) {
          setPublicLinkLoading(false);
        }
      }
    },
    [deal?.deal_id, selectedSessionId],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      hasLoadedPersistedStateRef.current = true;
      return;
    }

    let parsedState: PersistedCertificatePageState | null = null;

    try {
      const storedValue = window.localStorage.getItem(CERTIFICATES_STORAGE_KEY);
      if (storedValue) {
        parsedState = JSON.parse(storedValue) as PersistedCertificatePageState;
      }
    } catch (error) {
      parsedState = null;
    }

    const storedDealId =
      parsedState && typeof parsedState.dealIdInput === 'string'
        ? parsedState.dealIdInput
        : '';

    if (storedDealId) {
      setDealIdInput(storedDealId);
      void loadDealAndSessions(storedDealId);
    } else {
      setDealIdInput('');
    }

    const storedTemplateKey = parsedState?.selectedTemplateKey;
    if (typeof storedTemplateKey === 'string' && storedTemplateKey.trim().length > 0) {
      pendingPersistedTemplateKeyRef.current = storedTemplateKey;
    } else {
      pendingPersistedTemplateKeyRef.current = null;
    }

    const manualFlag =
      typeof parsedState?.templateSelectionManuallyChanged === 'boolean'
        ? parsedState.templateSelectionManuallyChanged
        : false;
    setTemplateSelectionManuallyChanged(manualFlag);
    pendingTemplateManualRef.current = manualFlag;

    pendingPersistedSessionRef.current =
      parsedState && typeof parsedState.selectedSessionId === 'string'
        ? parsedState.selectedSessionId
        : null;

    pendingPersistedRowsRef.current = Array.isArray(parsedState?.editableRows)
      ? parsedState?.editableRows.slice()
      : null;

    pendingPersistedExcludedIdsRef.current = Array.isArray(parsedState?.excludedCertifiedIds)
      ? parsedState?.excludedCertifiedIds.slice()
      : null;

    hasLoadedPersistedStateRef.current = true;
  }, [loadDealAndSessions, setTemplateSelectionManuallyChanged]);

  const setGenerationStepStatus = useCallback(
    (stepId: GenerationStepId, status: GenerationStepStatus) => {
      setGenerationSteps((current) =>
        current.map((step) => (step.id === stepId ? { ...step, status } : step)),
      );
    },
    [setGenerationSteps],
  );

  useEffect(() => {
    const pendingSessionId = pendingPersistedSessionRef.current;
    if (!pendingSessionId) {
      return;
    }

    const sessionExists = sessions.some((session) => session.id === pendingSessionId);
    if (!sessionExists) {
      pendingPersistedSessionRef.current = null;
      return;
    }

    pendingPersistedSessionRef.current = null;
    void selectSession(pendingSessionId);
  }, [sessions, selectSession]);

  useEffect(() => {
    const persistedRows = pendingPersistedRowsRef.current;
    let nextEditableRows: CertificateRow[];

    if (persistedRows) {
      if (persistedRows.length) {
        const persistedMap = new Map(persistedRows.map((row) => [row.id, row]));
        nextEditableRows = rows.map((row) => {
          const persisted = persistedMap.get(row.id);
          return persisted ? { ...row, ...persisted } : { ...row };
        });
      } else {
        nextEditableRows = rows.map((row) => ({ ...row }));
      }
      pendingPersistedRowsRef.current = null;
    } else {
      nextEditableRows = rows.map((row) => ({ ...row }));
    }

    setEditableRows(nextEditableRows);

    if (!nextEditableRows.length) {
      setShowCertifiedWarning(false);
      suppressCertifiedWarningRef.current = false;
      return;
    }

    const hasCertifiedRows = nextEditableRows.some((row) => row.certificado);

    if (suppressCertifiedWarningRef.current) {
      setShowCertifiedWarning(false);
      suppressCertifiedWarningRef.current = false;
      return;
    }

    setShowCertifiedWarning(hasCertifiedRows);
  }, [rows]);

  useEffect(() => {
    if (pendingTemplateManualRef.current !== null) {
      setTemplateSelectionManuallyChanged(pendingTemplateManualRef.current);
      pendingTemplateManualRef.current = null;
      return;
    }
    setTemplateSelectionManuallyChanged(false);
  }, [selectedSessionId, setTemplateSelectionManuallyChanged]);

  useEffect(() => {
    const pendingKey = pendingPersistedTemplateKeyRef.current;
    if (!pendingKey) {
      return;
    }

    const directMatch = templateOptions.some((option) => option.key === pendingKey);
    if (directMatch) {
      setSelectedTemplateKey(pendingKey);
      pendingPersistedTemplateKeyRef.current = null;
      return;
    }

    const api = trainingTemplatesApiRef.current;
    const normalisedPending = normaliseTemplateKey(pendingKey, api);
    if (!normalisedPending) {
      pendingPersistedTemplateKeyRef.current = null;
      return;
    }

    const matchedOption = templateOptions.find(
      (option) => normaliseTemplateKey(option.key, api) === normalisedPending,
    );

    if (matchedOption) {
      setSelectedTemplateKey(matchedOption.key);
      pendingPersistedTemplateKeyRef.current = null;
      return;
    }

    if (templateOptions.length > 0) {
      pendingPersistedTemplateKeyRef.current = null;
    }
  }, [templateOptions]);

  useEffect(() => {
    if (!selectedTemplateKey) {
      return;
    }
    const hasCurrent = templateOptions.some((option) => option.key === selectedTemplateKey);
    if (!hasCurrent && !pendingPersistedTemplateKeyRef.current) {
      setSelectedTemplateKey('');
    }
  }, [selectedTemplateKey, templateOptions]);

  useEffect(() => {
    if (templateSelectionManuallyChangedRef.current) {
      return;
    }

    const api = trainingTemplatesApiRef.current;
    const candidates: string[] = [];

    if (selectedSession?.productTemplate) {
      candidates.push(selectedSession.productTemplate);
    }

    const referenceProductName = selectedSession?.productName ?? rows[0]?.formacion ?? '';
    if (referenceProductName) {
      candidates.push(referenceProductName);
    }

    for (const candidate of candidates) {
      const matchedOption = findMatchingTemplateOption(templateOptions, candidate, api);
      if (matchedOption) {
        setSelectedTemplateKey((current) =>
          current === matchedOption.key ? current : matchedOption.key,
        );
        return;
      }
    }
  }, [rows, selectedSession, templateOptions]);

  useEffect(() => {
    setGenerationError(null);
    setGenerationProgress(0);
    setGenerationTotal(0);
    setGenerationResults([]);
    resetGenerationSteps();
  }, [selectedSessionId, resetGenerationSteps]);

  useEffect(() => {
    const pendingExcluded = pendingPersistedExcludedIdsRef.current;
    if (pendingExcluded) {
      setExcludedCertifiedIds(new Set(pendingExcluded));
      pendingPersistedExcludedIdsRef.current = null;
      return;
    }
    setExcludedCertifiedIds(new Set<string>());
  }, [selectedSessionId]);

  useEffect(() => {
    setExcludedCertifiedIds((current) => {
      if (!current.size) {
        return current;
      }
      if (!editableRows.length) {
        if (!current.size) {
          return current;
        }
        return new Set<string>();
      }

      const certifiedIds = new Set(editableRows.filter((row) => row.certificado).map((row) => row.id));
      let changed = false;
      const next = new Set<string>();
      current.forEach((id) => {
        if (certifiedIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });

      if (!changed && next.size === current.size) {
        return current;
      }
      return next;
    });
  }, [editableRows]);

  useEffect(() => {
    void pdfMakeReady.catch(() => {
      // pdfMake se inicializará de nuevo cuando el usuario intente generar.
    });
  }, []);

  useEffect(() => {
    void ensureSessionPublicLink({ forceCreate: false });
  }, [ensureSessionPublicLink]);

  const handleRowsChange = useCallback((nextRows: CertificateRow[]) => {
    setEditableRows(nextRows);
  }, []);

  const runCertificateGeneration = useCallback(
    async (options?: { rows?: CertificateRow[]; resetResults?: boolean }) => {
      const dealId = deal?.deal_id ? String(deal.deal_id).trim() : '';
      const sessionId = selectedSessionId ? String(selectedSessionId).trim() : '';
      const rowsToProcess = options?.rows ? options.rows.slice() : editableRows.slice();
      const shouldResetResults = options?.resetResults !== false;

      setGenerationError(null);
      setGenerationProgress(0);
      setGenerationTotal(0);

      if (!dealId) {
        setGenerationError('Selecciona un deal válido antes de generar certificados.');
        return;
      }

      if (!sessionId) {
        setGenerationError('Selecciona una sesión antes de generar certificados.');
        return;
      }

      if (!rowsToProcess.length) {
        if (shouldResetResults) {
          setGenerationError('No hay alumnos disponibles para generar certificados.');
        }
        return;
      }

      if (rowsToProcess.some((row) => !isRowComplete(row))) {
        setGenerationError('Completa el nombre, los apellidos y el DNI de todos los alumnos.');
        return;
      }

      generationAbortRef.current = { cancelled: false };
      setIsCancellingGeneration(false);

      const throwIfCancelled = () => {
        if (generationAbortRef.current?.cancelled) {
          throw new GenerationCancelledError();
        }
      };

      resetGenerationSteps();
      setGenerationStepStatus('loadGenerator', 'working');

      try {
        throwIfCancelled();
        await pdfMakeReady;
        throwIfCancelled();
        setGenerationStepStatus('loadGenerator', 'success');
      } catch (error) {
        setGenerationStepStatus('loadGenerator', 'error');
        const resolvedError = error instanceof GenerationCancelledError
          ? error.message
          : resolveGenerationError(error);
        setGenerationError(resolvedError);
        setIsCancellingGeneration(false);
        generationAbortRef.current = null;
        return;
      }

      if (shouldResetResults) {
        setGenerationResults([]);
      }

      setGenerationTotal(rowsToProcess.length);
      setGenerating(true);
      setGenerationStepStatus('generatePdf', 'working');

      const rowsOrder = editableRows.map((row) => row.id);
      const selectedTemplateOption = templateOptions.find(
        (option) => option.key === selectedTemplateKey,
      );
      const selectedTrainingTemplate = selectedTemplateOption?.template ?? null;

      const updateResultsState = (result: GenerationResult) => {
        setGenerationResults((current) => {
          const map = new Map(current.map((item) => [item.id, item]));
          map.set(result.id, result);
          const orderedResults = rowsOrder
            .filter((rowId) => map.has(rowId))
            .map((rowId) => map.get(rowId) as GenerationResult);
          if (orderedResults.length === map.size) {
            return orderedResults;
          }
          const remaining = Array.from(map.values()).filter(
            (item) => !rowsOrder.includes(item.id),
          );
          return [...orderedResults, ...remaining];
        });
      };

      let hasStartedUpload = false;
      let encounteredGenerationError = false;
      let encounteredUploadError = false;

      type ProcessRowError = { stage: GenerationFailureStage; error: unknown };

      const processRowWithRetry = async (row: CertificateRow) => {
        const studentLabel = buildStudentDisplayName(row);
        let lastError: ProcessRowError | null = null;

        for (let attempt = 1; attempt <= CERTIFICATE_MAX_RETRIES; attempt += 1) {
          throwIfCancelled();
          let currentStage: GenerationFailureStage = 'generate';
          try {
            throwIfCancelled();
            const certificateData = mapRowToCertificateGenerationData(row, {
              deal,
              session: selectedSession,
            });
            if (selectedTrainingTemplate) {
              const templateTitle =
                selectedTrainingTemplate.title || selectedTrainingTemplate.name;
              if (templateTitle) {
                certificateData.producto.name = templateTitle;
              }
              if (selectedTrainingTemplate.theory.length) {
                certificateData.theoreticalItems = selectedTrainingTemplate.theory.slice();
              }
              if (selectedTrainingTemplate.practice.length) {
                certificateData.practicalItems = selectedTrainingTemplate.practice.slice();
              }
            }
            const blob = await generateCertificatePDF(certificateData);
            throwIfCancelled();

            if (!(blob instanceof Blob) || !blob.size) {
              throw new Error('El certificado generado está vacío.');
            }

            const fileName = buildCertificateFileName(row, selectedSession ?? null);
            throwIfCancelled();

            currentStage = 'upload';
            if (!hasStartedUpload) {
              hasStartedUpload = true;
              setGenerationStepStatus('uploadCertificates', 'working');
            }
            throwIfCancelled();
            const uploadResult = await uploadSessionCertificate({
              dealId,
              sessionId,
              studentId: row.id,
              fileName,
              file: blob,
            });
            throwIfCancelled();

            const publicUrl = toNonEmptyString(uploadResult.publicUrl);
            const studentDriveUrl = toNonEmptyString(uploadResult.student?.drive_url ?? null);
            const resolvedUrl = studentDriveUrl ?? publicUrl ?? row.driveUrl ?? null;
            const studentCertificateFlag = uploadResult.student?.certificado ?? null;
            const resolvedCertificateFlag =
              studentCertificateFlag === null || studentCertificateFlag === undefined
                ? true
                : Boolean(studentCertificateFlag);

            setEditableRows((current) =>
              current.map((item) =>
                item.id === row.id
                  ? { ...item, certificado: resolvedCertificateFlag, driveUrl: resolvedUrl }
                  : item,
              ),
            );

            return { id: row.id, label: studentLabel, status: 'success', url: resolvedUrl };
          } catch (error: unknown) {
            const stageError: ProcessRowError = {
              stage: currentStage,
              error,
            };
            lastError = stageError;
            if (attempt < CERTIFICATE_MAX_RETRIES) {
              await wait(CERTIFICATE_RETRY_DELAY_MS * attempt);
              throwIfCancelled();
              continue;
            }
          }
        }

        const failureStage = lastError?.stage ?? 'generate';
        const resolvedMessage = resolveGenerationError(lastError?.error).trim();
        const attemptsInfo =
          CERTIFICATE_MAX_RETRIES > 1 ? ` Intentos realizados: ${CERTIFICATE_MAX_RETRIES}.` : '';
        const failurePrefix =
          failureStage === 'upload'
            ? 'No se pudo subir el certificado.'
            : 'No se pudo generar el archivo PDF del certificado.';
        const messageBody = resolvedMessage.length ? ` ${resolvedMessage}` : '';
        return {
          id: row.id,
          label: studentLabel,
          status: 'error',
          stage: failureStage,
          message: `${failurePrefix}${messageBody}${attemptsInfo}`,
          url: null,
        };
      };

      try {
        for (
          let startIndex = 0;
          startIndex < rowsToProcess.length;
          startIndex += CERTIFICATE_BATCH_SIZE
        ) {
          throwIfCancelled();
          const batch = rowsToProcess.slice(startIndex, startIndex + CERTIFICATE_BATCH_SIZE);
          await Promise.all(
            batch.map(async (row) => {
              throwIfCancelled();
              const result = await processRowWithRetry(row);
              updateResultsState(result);
              setGenerationProgress((current) => current + 1);
              if (result.status === 'error') {
                if (result.stage === 'generate') {
                  encounteredGenerationError = true;
                }
                if (result.stage === 'upload') {
                  encounteredUploadError = true;
                }
              }
            }),
          );
        }

        setGenerationStepStatus('generatePdf', encounteredGenerationError ? 'error' : 'success');

        if (hasStartedUpload) {
          setGenerationStepStatus(
            'uploadCertificates',
            encounteredUploadError ? 'error' : 'success',
          );
        }

        throwIfCancelled();
        setGenerationStepStatus('refreshStudents', 'working');
        try {
          suppressCertifiedWarningRef.current = true;
          await selectSession(sessionId);
          throwIfCancelled();
          setGenerationStepStatus('refreshStudents', 'success');
          throwIfCancelled();
          await ensureSessionPublicLink({ forceCreate: true });
        } catch (reloadError) {
          suppressCertifiedWarningRef.current = false;
          setGenerationStepStatus('refreshStudents', 'error');
          const reloadErrorMessage = resolveGenerationError(reloadError);
          setGenerationError(`No se pudo recargar el listado de alumnos (${reloadErrorMessage}).`);
        }
      } catch (error) {
        setGenerationStepStatus('generatePdf', 'error');
        if (hasStartedUpload) {
          setGenerationStepStatus('uploadCertificates', 'error');
        }
        if (error instanceof GenerationCancelledError) {
          setGenerationError(error.message);
        } else {
          const message = resolveGenerationError(error);
          setGenerationError(message);
        }
      } finally {
        setGenerating(false);
        setIsCancellingGeneration(false);
        generationAbortRef.current = null;
      }
    },
    [
      deal,
      selectedSession,
      selectedSessionId,
      editableRows,
      selectSession,
      resetGenerationSteps,
      setGenerationStepStatus,
      ensureSessionPublicLink,
      selectedTemplateKey,
      templateOptions,
    ],
  );

  const handleCertifiedToggle = useCallback((studentId: string, checked: boolean) => {
    setExcludedCertifiedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  }, []);

  const handleGenerateCertificates = useCallback(() => {
    const rowsToGenerate = editableRows.filter(
      (row) => !row.certificado || !excludedCertifiedIds.has(row.id),
    );
    if (!rowsToGenerate.length) {
      return;
    }
    void runCertificateGeneration({ rows: rowsToGenerate, resetResults: true });
  }, [editableRows, excludedCertifiedIds, runCertificateGeneration]);

  const handleCancelGeneration = useCallback(() => {
    if (!generating) {
      return;
    }
    const abortSignal = generationAbortRef.current;
    if (abortSignal && !abortSignal.cancelled) {
      abortSignal.cancelled = true;
      setIsCancellingGeneration(true);
    }
  }, [generating]);

  const handleRetryFailed = useCallback(() => {
    const failedIds = new Set(
      generationResults.filter((result) => result.status === 'error').map((result) => result.id),
    );
    if (!failedIds.size) {
      return;
    }
    const rowsToRetry = editableRows.filter((row) => failedIds.has(row.id));
    if (!rowsToRetry.length) {
      return;
    }
    void runCertificateGeneration({ rows: rowsToRetry, resetResults: false });
  }, [editableRows, generationResults, runCertificateGeneration]);

  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => ({
        id: session.id,
        label: buildSessionLabel(session),
      })),
    [sessions],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    loadDealAndSessions(dealIdInput);
  };

  const handleSessionChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    selectSession(value ? value : null);
  };

  const handleTemplateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setTemplateSelectionManuallyChanged(true);
    setSelectedTemplateKey(value);
  };

  const handlePreviewTemplate = () => {
    setShowTemplatePreview(true);
    setTemplatePreviewUrl(null);
    setTemplatePreviewError(null);
    setLoadingTemplatePreview(true);

    void (async () => {
      try {
        await pdfMakeReady;
        const selectedTemplateOption = templateOptions.find(
          (option) => option.key === selectedTemplateKey,
        );
        const selectedTemplate = selectedTemplateOption?.template ?? null;
        const dataUrl = await generateCertificateTemplatePreviewDataUrl(
          selectedTemplate
            ? {
                courseName: selectedTemplate.title || selectedTemplate.name,
                theoreticalItems: selectedTemplate.theory,
                practicalItems: selectedTemplate.practice,
              }
            : undefined,
        );
        setTemplatePreviewUrl(dataUrl);
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'No se pudo generar la previsualización del certificado.';
        setTemplatePreviewError(message);
      } finally {
        setLoadingTemplatePreview(false);
      }
    })();
  };

  const handleCloseTemplatePreview = () => {
    setShowTemplatePreview(false);
  };

  const handleTemplatePreviewExited = () => {
    setTemplatePreviewUrl(null);
    setTemplatePreviewError(null);
    setLoadingTemplatePreview(false);
  };

  const handleClearData = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(CERTIFICATES_STORAGE_KEY);
      } catch (error) {
        // Ignorado: almacenamiento no disponible.
      }
    }

    pendingPersistedSessionRef.current = null;
    pendingPersistedRowsRef.current = null;
    pendingPersistedExcludedIdsRef.current = null;
    pendingTemplateManualRef.current = null;

    if (generationAbortRef.current && !generationAbortRef.current.cancelled) {
      generationAbortRef.current.cancelled = true;
    }
    generationAbortRef.current = null;

    suppressCertifiedWarningRef.current = false;
    publicLinkRequestIdRef.current += 1;

    setDealIdInput('');
    resetCertificateData();

    setEditableRows([]);
    setExcludedCertifiedIds(new Set<string>());
    setShowCertifiedWarning(false);

    setGenerationError(null);
    setGenerationProgress(0);
    setGenerationTotal(0);
    setGenerationResults([]);
    resetGenerationSteps();
    setGenerating(false);
    setIsCancellingGeneration(false);

    setPublicLinkUrl(null);
    setPublicLinkError(null);
    setPublicLinkLoading(false);

    setSelectedTemplateKey('');
    setTemplateSelectionManuallyChanged(false);

    setShowTemplatePreview(false);
    setTemplatePreviewUrl(null);
    setTemplatePreviewError(null);
    setLoadingTemplatePreview(false);
  }, [
    resetCertificateData,
    resetGenerationSteps,
    setTemplateSelectionManuallyChanged,
  ]);

  const alreadyCertifiedRows = useMemo(
    () => editableRows.filter((row) => row.certificado),
    [editableRows],
  );
  const incompleteRows = useMemo(
    () => editableRows.filter((row) => !isRowComplete(row)),
    [editableRows],
  );
  const hasRowsToGenerate = useMemo(
    () => editableRows.some((row) => !row.certificado || !excludedCertifiedIds.has(row.id)),
    [editableRows, excludedCertifiedIds],
  );
  const hasIncompleteRows = incompleteRows.length > 0;
  const hasDealId = Boolean(deal?.deal_id);
  const hasSelectedSession = Boolean(selectedSessionId);
  const showSessionsSelect = sessions.length > 1;
  const showAutoSelectedSession = sessions.length === 1 && selectedSession;
  const hasResults = editableRows.length > 0;
  const hasCertifiedRows = showCertifiedWarning && alreadyCertifiedRows.length > 0;
  const hasVisibleStepProgress = generationSteps.some((step) => step.status !== 'pending');
  const isToolbarDisabled =
    !hasResults ||
    loadingStudents ||
    generating ||
    !hasDealId ||
    !hasSelectedSession ||
    hasIncompleteRows ||
    !hasRowsToGenerate;

  const toolbarDisabledReason = (() => {
    if (generating) {
      return 'Generación de certificados en curso. Consulta el detalle del progreso.';
    }
    if (loadingStudents) {
      return 'Cargando alumnos. Espera a que finalice la carga.';
    }
    if (!hasDealId) {
      return 'Busca un deal válido antes de generar los certificados.';
    }
    if (!hasSelectedSession) {
      return 'Selecciona una sesión para generar los certificados.';
    }
    if (!hasResults) {
      return 'No hay alumnos disponibles para generar certificados.';
    }
    if (hasIncompleteRows) {
      return 'Completa el nombre, apellidos y DNI de todos los alumnos.';
    }
    if (!hasRowsToGenerate) {
      return 'Selecciona al menos un alumno para generar certificados.';
    }
    return undefined;
  })();

  const toolbarInfoMessage = (() => {
    if (generating || hasVisibleStepProgress) {
      return undefined;
    }
    if (toolbarDisabledReason) {
      return toolbarDisabledReason;
    }
    return undefined;
  })();

  const toolbarInfoDetails = hasVisibleStepProgress ? generationSteps : undefined;

  const generationSummary = useMemo(() => {
    if (!generationResults.length) {
      return null;
    }
    const successCount = generationResults.filter((result) => result.status === 'success').length;
    const errorCount = generationResults.filter((result) => result.status === 'error').length;
    return { total: generationResults.length, successCount, errorCount };
  }, [generationResults]);

  const hasGenerationFailures = Boolean(generationSummary && generationSummary.errorCount > 0);

  useEffect(() => {
    if (!hasLoadedPersistedStateRef.current) {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    if (!dealIdInput) {
      window.localStorage.removeItem(CERTIFICATES_STORAGE_KEY);
      return;
    }

    const stateToPersist: PersistedCertificatePageState = {
      dealIdInput,
      selectedSessionId: selectedSessionId ?? null,
      editableRows,
      selectedTemplateKey,
      templateSelectionManuallyChanged: templateSelectionManuallyChangedState,
      excludedCertifiedIds: Array.from(excludedCertifiedIds),
    };

    try {
      window.localStorage.setItem(CERTIFICATES_STORAGE_KEY, JSON.stringify(stateToPersist));
    } catch (error) {
      // Ignored: almacenamiento no disponible.
    }
  }, [
    dealIdInput,
    editableRows,
    excludedCertifiedIds,
    selectedSessionId,
    selectedTemplateKey,
    templateSelectionManuallyChangedState,
  ]);

  return (
    <div className="d-flex justify-content-center">
      <Card className="shadow-sm border-0 w-100" style={{ maxWidth: '1248px' }}>
        <Card.Body className="p-4">
          <Card.Title as="h1" className="h4 fw-bold mb-4 text-uppercase text-center">
            Certificados
          </Card.Title>

          <Form onSubmit={handleSubmit} className="mb-4">
            <Form.Group controlId="certificate-deal" className="text-start">
              <Form.Label>Introduce el número de presupuesto</Form.Label>
              <div className="deal-search-controls">
                <Form.Control
                  type="text"
                  placeholder="Ej. 1234"
                  value={dealIdInput}
                  onChange={(event) => setDealIdInput(event.target.value)}
                  disabled={loadingDeal}
                  className="deal-search-controls__input"
                />
                <Button type="submit" variant="primary" disabled={loadingDeal}>
                  {loadingDeal ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Buscando...
                    </>
                  ) : (
                    'Buscar'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline-secondary"
                  onClick={handleClearData}
                  disabled={loadingDeal || generating}
                  className="deal-search-controls__clear-button"
                >
                  Limpiar datos
                </Button>
              </div>
            </Form.Group>
          </Form>

          {dealError && (
            <Alert variant="danger" className="text-start">
              {dealError}
            </Alert>
          )}

          {deal && !sessions.length && !loadingDeal && (
            <Alert variant="info" className="text-start">
              No se han encontrado sesiones asociadas a este deal.
            </Alert>
          )}

          {showSessionsSelect && (
            <Form.Group controlId="certificate-session" className="text-start mb-4">
              <Form.Label>Selecciona una sesión</Form.Label>
              <Form.Select
                value={selectedSessionId ?? ''}
                onChange={handleSessionChange}
                disabled={loadingStudents}
              >
                <option value="">Selecciona una sesión</option>
                {sessionOptions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}

          {showAutoSelectedSession && (
            <div className="mb-4 text-start">
              <div className="text-muted small mb-1">Sesión seleccionada automáticamente</div>
              <div className="fw-semibold">{buildSessionLabel(selectedSession)}</div>
            </div>
          )}

          {studentsError && !loadingStudents && (
            <Alert variant="danger" className="text-start">
              {studentsError}
            </Alert>
          )}

          {loadingStudents && (
            <div className="d-flex align-items-center gap-2 text-muted mb-3">
              <Spinner animation="border" size="sm" />
              <span>Cargando alumnos…</span>
            </div>
          )}

          {hasResults && (
            <div className="certificate-panel">
              <div className="certificate-template-controls">
                <Form.Group controlId="certificate-template" className="mb-0">
                  <Form.Label className="mb-1">Template del certificado</Form.Label>
                  <Form.Select
                    value={selectedTemplateKey}
                    onChange={handleTemplateChange}
                    size="sm"
                    className="certificate-template-controls__select"
                    disabled={loadingStudents || templateOptions.length === 0}
                  >
                    <option value="">Selecciona una plantilla</option>
                    {templateOptions.map((templateOption) => (
                      <option key={templateOption.key} value={templateOption.key}>
                        {templateOption.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={handlePreviewTemplate}
                  disabled={loadingTemplatePreview}
                  className="certificate-template-controls__button"
                >
                  {loadingTemplatePreview ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Generando previsualización…
                    </>
                  ) : (
                    'Previsualizar template'
                  )}
                </Button>
              </div>

              <CertificateToolbar
                onGenerate={handleGenerateCertificates}
                onCancel={generating ? handleCancelGeneration : undefined}
                disabled={isToolbarDisabled}
                loading={generating}
                progress={generationProgress}
                total={generationTotal}
                infoMessage={toolbarInfoMessage}
                infoDetails={toolbarInfoDetails}
                disabledReason={toolbarDisabledReason}
                canCancel={!isCancellingGeneration}
                cancelling={isCancellingGeneration}
              />
              {hasCertifiedRows && (
                <Alert variant="warning" className="text-start mt-3">
                  <div className="fw-semibold mb-2">
                    Los siguientes Alumnos tienen un certificado hecho, ¿Rehacer?
                  </div>
                  <div className="d-flex flex-column gap-1">
                    {alreadyCertifiedRows.map((row) => {
                      const checkboxId = `certificate-regenerate-${row.id}`;
                      const checked = !excludedCertifiedIds.has(row.id);
                      return (
                        <Form.Check
                          key={row.id}
                          id={checkboxId}
                          type="checkbox"
                          label={buildStudentDisplayName(row)}
                          checked={checked}
                          onChange={(event) =>
                            handleCertifiedToggle(row.id, event.target.checked)
                          }
                        />
                      );
                    })}
                  </div>
                </Alert>
              )}
              <CertificateTable
                rows={editableRows}
                onRowsChange={handleRowsChange}
                disabled={loadingStudents || generating}
              />
              {hasIncompleteRows && (
                <Alert variant="warning" className="text-start mt-3">
                  {incompleteRows.length === 1
                    ? 'Falta completar el nombre, apellidos y DNI de 1 alumno.'
                    : `Faltan completar el nombre, apellidos y DNI de ${incompleteRows.length} alumnos.`}
                </Alert>
              )}
              {generationError && (
                <Alert variant="danger" className="text-start mt-3">
                  {generationError}
                </Alert>
              )}
              {!generating && generationSummary && (
                <>
                  <Alert
                    variant={hasGenerationFailures ? 'warning' : 'success'}
                    className="text-start mt-3"
                  >
                    {hasGenerationFailures
                      ? `Se generaron ${generationSummary.successCount} de ${generationSummary.total} certificados. Revisa el detalle para ver los alumnos con incidencias.`
                      : 'Se generaron todos los certificados correctamente.'}
                  </Alert>
                  {!hasGenerationFailures && (
                    <div className="mt-2 text-start">
                      {publicLinkLoading ? (
                        <div className="text-muted small">
                          Obteniendo enlace público de certificados…
                        </div>
                      ) : publicLinkUrl ? null : publicLinkError ? (
                        <div className="text-danger small">
                          No se pudo obtener el enlace público de certificados. {publicLinkError}
                        </div>
                      ) : null}
                    </div>
                  )}
                </>
              )}
              {hasGenerationFailures && !generating && (
                <div className="mt-2 text-start">
                  <Button variant="outline-primary" onClick={handleRetryFailed}>
                    Reintentar fallidos
                  </Button>
                </div>
              )}
              {generationResults.length > 0 && (
                <div className="certificate-generation-results mt-3 text-start">
                  <div className="fw-semibold mb-2">Detalle por alumno</div>
                  <ul className="certificate-generation-results__list">
                    {generationResults.map((result) => (
                      <li key={result.id} className="certificate-generation-results__item">
                        <span
                          className={`certificate-generation-results__status ${
                            result.status === 'success'
                              ? 'certificate-generation-results__status--success'
                              : 'certificate-generation-results__status--error'
                          }`}
                          aria-label={result.status === 'success' ? 'Correcto' : 'Error'}
                        >
                          {result.status === 'success' ? '✔️' : '❌'}
                        </span>
                        <div>
                          <div className="fw-semibold">
                            {result.status === 'success' && result.url ? (
                              <a
                                href={result.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="link-primary"
                              >
                                {result.label}
                              </a>
                            ) : (
                              result.label
                            )}
                          </div>
                          <div
                            className={`certificate-generation-results__message ${
                              result.status === 'success'
                                ? 'certificate-generation-results__message--success'
                                : 'certificate-generation-results__message--error'
                            }`}
                          >
                            {result.status === 'success'
                              ? 'Generado correctamente.'
                              : result.message}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {!hasResults && selectedSessionId && !loadingStudents && (
            <Alert variant="secondary" className="text-start">
              No se han encontrado alumnos para la sesión seleccionada.
            </Alert>
          )}
        </Card.Body>
      </Card>

      <Modal
        show={showTemplatePreview}
        onHide={handleCloseTemplatePreview}
        onExited={handleTemplatePreviewExited}
        size="xl"
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Previsualización del template</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {templatePreviewError && (
            <Alert variant="danger" className="mb-3">
              {templatePreviewError}
            </Alert>
          )}
          {loadingTemplatePreview && !templatePreviewError && (
            <div className="d-flex justify-content-center align-items-center py-5">
              <Spinner animation="border" role="status" />
              <span className="ms-2">Generando vista previa…</span>
            </div>
          )}
          {!loadingTemplatePreview && templatePreviewUrl && !templatePreviewError && (
            <div className="template-preview-frame">
              <iframe
                src={templatePreviewUrl}
                title="Previsualización del template"
                className="template-preview-frame__content"
              />
            </div>
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
}
