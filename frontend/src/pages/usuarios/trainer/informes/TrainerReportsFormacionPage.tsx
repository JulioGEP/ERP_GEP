import { useLocation } from 'react-router-dom';
import { useMemo } from 'react';
import { ReportsFlow, type ReportDraft } from '../../../../features/informes/ReportsFlow';

type TrainerReportLocationState = {
  reportPrefill?: Partial<ReportDraft> | null;
} | null;

export default function TrainerReportsFormacionPage() {
  const location = useLocation();
  const initialDraft = useMemo(() => {
    const state = location.state as TrainerReportLocationState;
    const payload = state?.reportPrefill;
    if (!payload) return undefined;

    const draft: Partial<ReportDraft> = {
      ...payload,
      type: 'formacion',
    };

    if (payload.dealId !== undefined && payload.dealId !== null) {
      draft.dealId = String(payload.dealId);
    }

    if (payload.datos && typeof payload.datos === 'object') {
      draft.datos = { ...payload.datos };
    }

    if (payload.formador && typeof payload.formador === 'object') {
      draft.formador = { ...payload.formador };
    }

    if (payload.session && typeof payload.session === 'object') {
      draft.session = { ...payload.session };
    }

    if (Array.isArray(payload.sessionOptions)) {
      draft.sessionOptions = payload.sessionOptions.map((option) => ({ ...option }));
    }

    if (Array.isArray(payload.imagenes)) {
      draft.imagenes = payload.imagenes.map((imagen) => ({ ...(imagen ?? {}) }));
    }

    return draft;
  }, [location.state]);

  return (
    <section className="py-2 py-md-3">
      <ReportsFlow type="formacion" initialDraft={initialDraft} />
    </section>
  );
}
