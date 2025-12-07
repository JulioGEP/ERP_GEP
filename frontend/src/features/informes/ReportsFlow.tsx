import { useEffect, useMemo, useState } from 'react';
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
  sessions?: ReportSessionInfo[];
  sessionOptions?: ReportSessionInfo[];
};

type Stage = 'form' | 'preview';

const TITLES: Record<ReportType, string> = {
  formacion: 'Informe de Formación',
  simulacro: 'Informe de Simulacro',
  preventivo: 'Informe de Preventivos',
  'preventivo-ebro': 'Informe Recurso Preventivo EBRO',
};

const createEmptyDraft = (type: ReportType): ReportDraft => ({
  type,
  dealId: '',
  formador: { nombre: '', idioma: 'ES' },
  datos: { tipo: type, idioma: 'ES' },
  imagenes: [],
  session: null,
  sessions: [],
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

  if (Array.isArray(input.sessions)) {
    next.sessions = input.sessions
      .filter((option): option is ReportSessionInfo => Boolean(option))
      .map((option) => ({ ...option }));
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
  const [stage, setStage] = useState<Stage>('form');
  const resolvedInitialDraft = useMemo(
    () => resolveInitialDraft(type, initialDraft),
    [type, initialDraft],
  );
  const [draft, setDraft] = useState<ReportDraft>(() => resolvedInitialDraft);

  useEffect(() => {
    setStage('form');
    setDraft(resolvedInitialDraft);
  }, [type, resolvedInitialDraft]);

  const resolvedTitle = useMemo(() => title || TITLES[type], [title, type]);

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

  // arriba, junto a los otros handlers
  const handleChooseAnother = () => {
    setDraft(createEmptyDraft(type));
    setStage('form');
  };

  return (
    <Form
      initial={formInitial}
      title={resolvedTitle}
      type={type}
      onNext={handleNext}
      onChooseAnother={handleChooseAnother}
    />
  );
}

export default ReportsFlow;
