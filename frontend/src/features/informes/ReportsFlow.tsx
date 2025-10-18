import { useEffect, useMemo, useState } from 'react';
import Form from './components/Form';
import Preview from './components/Preview';
import './main.css';

export type ReportType = 'formacion' | 'simulacro' | 'preventivo' | 'preventivo-ebro';

type ReportDraft = {
  type: ReportType;
  dealId?: string;
  datos?: Record<string, any>;
  formador?: { nombre?: string; idioma?: string };
  imagenes?: Array<{ name?: string; dataUrl?: string }>;
};

type Stage = 'form' | 'preview';

export interface ReportsFlowProps {
  type: ReportType;
  title?: string;
}

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
});

export function ReportsFlow({ type, title }: ReportsFlowProps) {
  const [stage, setStage] = useState<Stage>('form');
  const [draft, setDraft] = useState<ReportDraft>(() => createEmptyDraft(type));

  useEffect(() => {
    setStage('form');
    setDraft((prev) => {
      if (prev?.type === type) {
        return prev;
      }
      return createEmptyDraft(type);
    });
  }, [type]);

  const resolvedTitle = useMemo(() => title || TITLES[type], [title, type]);

  const handleNext = (nextDraft: ReportDraft) => {
    setDraft(nextDraft);
    setStage('preview');
  };

  const handleBack = () => {
    setStage('form');
  };

  const formInitial = draft ?? createEmptyDraft(type);

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

  return (
    <Form
      initial={formInitial}
      title={resolvedTitle}
      type={type}
      onNext={handleNext}
    />
  );
}

export default ReportsFlow;
