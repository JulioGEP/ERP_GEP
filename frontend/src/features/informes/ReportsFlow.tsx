import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Form from './components/Form';
import Preview from './components/Preview';
import './main.css';

export type ReportType = 'formacion' | 'simulacro' | 'preventivo' | 'preventivo-ebro';

export type ReportSessionInfo = {
  id: string;
  number?: string | null;
  label?: string | null;
  direccion?: string | null;
  nombre?: string | null;
  fecha?: string | null;
};

export type ReportDraft = {
  type: ReportType;
  dealId?: string;
  datos?: Record<string, any>;
  formador?: { nombre?: string; idioma?: string };
  imagenes?: Array<{ name?: string; dataUrl?: string }>;
  session?: ReportSessionInfo | null;
  sessionOptions?: ReportSessionInfo[];
};

type Stage = 'form' | 'preview';

const TITLES: Record<ReportType, string> = {
  formacion: 'Informe de Formación',
  simulacro: 'Informe de Simulacro',
  preventivo: 'Informe de Preventivos',
  'preventivo-ebro': 'Informe Recurso Preventivo EBRO',
};

const TRAINER_REPORT_BASE_PATH = '/usuarios/trainer/informes';

const REPORT_ROUTE_SEGMENT: Record<ReportType, string> = {
  formacion: 'formacion',
  preventivo: 'preventivo',
  simulacro: 'simulacro',
  'preventivo-ebro': 'recurso_preventivo_ebro',
};

const REPORT_TYPE_OPTIONS: Array<{ value: ReportType; label: string }> = [
  { value: 'formacion', label: 'Formación' },
  { value: 'preventivo', label: 'Preventivo' },
  { value: 'simulacro', label: 'Simulacro' },
  { value: 'preventivo-ebro', label: 'Recurso Preventivo EBRO' },
];

const createEmptyDraft = (type: ReportType): ReportDraft => ({
  type,
  dealId: '',
  formador: { nombre: '', idioma: 'ES' },
  datos: { tipo: type, idioma: 'ES' },
  imagenes: [],
  session: null,
  sessionOptions: [],
});

function mergeReportDraft(
  base: ReportDraft,
  input: Partial<ReportDraft> | null | undefined,
  type: ReportType,
): ReportDraft {
  if (!input) {
    return base;
  }

  const next: ReportDraft = {
    ...base,
    type,
  };

  if (input.dealId !== undefined && input.dealId !== null) {
    next.dealId = String(input.dealId);
  }

  if (input.datos && typeof input.datos === 'object') {
    next.datos = { ...base.datos, ...input.datos };
  }

  if (input.formador && typeof input.formador === 'object') {
    next.formador = { ...base.formador, ...input.formador };
  }

  if (Array.isArray(input.imagenes)) {
    next.imagenes = input.imagenes.map((imagen) => ({ ...(imagen ?? {}) }));
  }

  if (input.session && typeof input.session === 'object') {
    next.session = { ...input.session };
  }

  if (Array.isArray(input.sessionOptions)) {
    next.sessionOptions = input.sessionOptions
      .filter((option): option is ReportSessionInfo => Boolean(option))
      .map((option) => ({ ...option }));
  }

  return next;
}

export interface ReportsFlowProps {
  type: ReportType;
  title?: string;
  initialDraft?: Partial<ReportDraft> | null;
}

const resolveInitialDraft = (
  type: ReportType,
  initialDraft: Partial<ReportDraft> | null | undefined,
): ReportDraft => {
  const base = createEmptyDraft(type);
  return mergeReportDraft(base, initialDraft, type);
};

export function ReportsFlow({ type, title, initialDraft }: ReportsFlowProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('form');

  const locationPrefill = useMemo(() => {
    const state = location.state as { reportPrefill?: Partial<ReportDraft> | null } | null;
    return state?.reportPrefill ?? null;
  }, [location.state]);

  const effectiveInitialDraft = initialDraft ?? locationPrefill;

  const resolvedInitialDraft = useMemo(
    () => resolveInitialDraft(type, effectiveInitialDraft),
    [effectiveInitialDraft, type],
  );
  const [draft, setDraft] = useState<ReportDraft>(() => resolvedInitialDraft);

  useEffect(() => {
    setStage('form');
    setDraft(resolvedInitialDraft);
  }, [type, resolvedInitialDraft]);

  const resolvedTitle = useMemo(() => title || TITLES[type], [title, type]);

  const trainerReportPrefill = effectiveInitialDraft ?? null;

  const handleNext = (nextDraft: ReportDraft) => {
    setDraft(nextDraft);
    setStage('preview');
  };

  const handleBack = () => {
    setStage('form');
  };

  const formInitial = draft ?? resolvedInitialDraft;

  if (stage === 'preview') {
    return (
      <Preview
        data={draft}
        title={resolvedTitle}
        type={type}
        onBack={handleBack}
      />
    );
  }

  const handleChooseAnother = () => {
    setDraft(createEmptyDraft(type));
    setStage('form');
  };

  const isTrainerReportsFlow = location.pathname.startsWith(TRAINER_REPORT_BASE_PATH);

  const chooseAnotherOptions = useMemo(() => {
    if (!isTrainerReportsFlow) return [];
    return REPORT_TYPE_OPTIONS.filter((option) => option.value !== type).map((option) => ({
      ...option,
      onClick: () => {
        const nextPath = `${TRAINER_REPORT_BASE_PATH}/${REPORT_ROUTE_SEGMENT[option.value]}`;
        navigate(nextPath, {
          state: trainerReportPrefill ? { reportPrefill: trainerReportPrefill } : undefined,
        });
      },
    }));
  }, [isTrainerReportsFlow, navigate, trainerReportPrefill, type]);

  return (
    <Form
      initial={formInitial}
      title={resolvedTitle}
      type={type}
      onNext={handleNext}
      onChooseAnother={handleChooseAnother}
      chooseAnotherOptions={chooseAnotherOptions as any}
    />
  );
}

export default ReportsFlow;
