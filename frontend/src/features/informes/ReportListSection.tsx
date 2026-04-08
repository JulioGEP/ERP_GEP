import { useMemo, useState } from 'react';
import { isApiError } from '../../api/client';
import { sendReportEmail } from '../../api/reports';
import type { ReportListEntry } from '../../api/reports';

const formatDate = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-ES');
};

type ReportListSectionProps = {
  title: string;
  description?: string;
  rows: ReportListEntry[];
  loading: boolean;
  error: string | null;
  emptyMessage?: string;
  canSendReport?: boolean;
};

type EmailDraft = {
  senderName: string;
  senderEmail: string;
  to: string;
  cc: string;
  body: string;
};

const DEFAULT_SENDER_NAME = 'Informes GEP Group';
const DEFAULT_SENDER_EMAIL = 'erp@gepgroup.es';
const DEFAULT_CC = 'sales@gepgroup.es';

const buildDefaultEmailBody = (publicReportUrl: string) =>
  `Hola

Adjuntamos enlace del informe ${publicReportUrl}

Jaime Martret - Director Técnico

Estamos en contacto
Gracias`;

export function ReportListSection({
  title,
  description,
  rows,
  loading,
  error,
  emptyMessage = 'No hay informes registrados todavía.',
  canSendReport = false,
}: ReportListSectionProps) {
  const [selectedReport, setSelectedReport] = useState<ReportListEntry | null>(null);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [localSentReportIds, setLocalSentReportIds] = useState<Record<string, true>>({});

  const isMailModalOpen = Boolean(selectedReport && emailDraft);

  const openSendReportModal = (report: ReportListEntry) => {
    setSendError(null);
    setSendSuccess(null);
    setSelectedReport(report);
    setEmailDraft({
      senderName: DEFAULT_SENDER_NAME,
      senderEmail: DEFAULT_SENDER_EMAIL,
      to: report.contact_email ?? '',
      cc: DEFAULT_CC,
      body: buildDefaultEmailBody(report.enlace ?? ''),
    });
  };

  const closeSendReportModal = () => {
    setSelectedReport(null);
    setEmailDraft(null);
    setSendError(null);
    setSendSuccess(null);
    setIsSending(false);
  };

  const modalTitle = useMemo(() => {
    if (!selectedReport?.presupuesto) return 'Simulación de envío de informe';
    return `Simulación de envío · Presupuesto ${selectedReport.presupuesto}`;
  }, [selectedReport?.presupuesto]);

  const handleSendReport = async () => {
    if (!selectedReport || !emailDraft || isSending) return;
    setSendError(null);
    setSendSuccess(null);
    setIsSending(true);
    try {
      await sendReportEmail({
        reportId: selectedReport.id,
        senderName: emailDraft.senderName,
        senderEmail: emailDraft.senderEmail,
        to: emailDraft.to,
        cc: emailDraft.cc,
        body: emailDraft.body,
      });
      setSendSuccess('Informe enviado correctamente.');
      setLocalSentReportIds((prev) => ({ ...prev, [selectedReport.id]: true }));
    } catch (error) {
      if (isApiError(error)) {
        setSendError(error.message || 'No se pudo enviar el informe.');
      } else if (error instanceof Error && error.message) {
        setSendError(error.message);
      } else {
        setSendError('No se pudo enviar el informe.');
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <section className="py-3">
        <div className="d-flex align-items-center justify-content-between mb-3">
          <div>
            {description ? <p className="text-muted mb-1">{description}</p> : null}
            <h2 className="h4 mb-0">{title}</h2>
          </div>
        </div>

        {error ? (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="text-center py-4">Cargando informes...</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-striped align-middle">
              <thead>
                <tr>
                  <th>Presupuesto</th>
                  <th>Empresa</th>
                  <th>Sesión</th>
                  <th>Fecha</th>
                  <th>Formador</th>
                  <th>Enlace</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-4">
                      {emptyMessage}
                    </td>
                  </tr>
                ) : (
                  rows.map((report) => {
                    const isSent = Boolean(report.email_enviado_en || localSentReportIds[report.id]);
                    return (
                    <tr key={report.id}>
                      <td>{report.presupuesto || '—'}</td>
                      <td>{report.empresa || '—'}</td>
                      <td>{report.sesion || '—'}</td>
                      <td>{formatDate(report.fecha)}</td>
                      <td>{report.formador || '—'}</td>
                      <td>
                        {report.enlace ? (
                          <div className="d-flex flex-wrap gap-2 align-items-center">
                            <a href={report.enlace} target="_blank" rel="noreferrer">
                              Ver informe
                            </a>
                            {canSendReport ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-primary"
                                  onClick={() => openSendReportModal(report)}
                                >
                                  Enviar
                                </button>
                                <span
                                  className={`badge ${isSent ? 'text-bg-success' : 'text-bg-secondary'}`}
                                  title={isSent ? 'Email enviado' : 'Email no enviado'}
                                  aria-label={isSent ? 'Email enviado' : 'Email no enviado'}
                                >
                                  {isSent ? '✓ Enviado' : 'Pendiente'}
                                </span>
                              </>
                            ) : null}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isMailModalOpen && emailDraft ? (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true">
            <div className="modal-dialog modal-lg modal-dialog-scrollable">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{modalTitle}</h5>
                  <button type="button" className="btn-close" aria-label="Close" onClick={closeSendReportModal} />
                </div>
                <div className="modal-body">
                  {sendError ? (
                    <div className="alert alert-danger py-2" role="alert">
                      {sendError}
                    </div>
                  ) : null}
                  {sendSuccess ? (
                    <div className="alert alert-success py-2" role="alert">
                      {sendSuccess}
                    </div>
                  ) : null}
                  <div className="mb-3">
                    <label className="form-label">Sender (nombre)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={emailDraft.senderName}
                      onChange={(event) =>
                        setEmailDraft((prev) => (prev ? { ...prev, senderName: event.target.value } : prev))
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Sender (email)</label>
                    <input
                      type="email"
                      className="form-control"
                      value={emailDraft.senderEmail}
                      onChange={(event) =>
                        setEmailDraft((prev) => (prev ? { ...prev, senderEmail: event.target.value } : prev))
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Para</label>
                    <input
                      type="email"
                      className="form-control"
                      value={emailDraft.to}
                      onChange={(event) =>
                        setEmailDraft((prev) => (prev ? { ...prev, to: event.target.value } : prev))
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">CC</label>
                    <input
                      type="text"
                      className="form-control"
                      value={emailDraft.cc}
                      onChange={(event) =>
                        setEmailDraft((prev) => (prev ? { ...prev, cc: event.target.value } : prev))
                      }
                    />
                  </div>
                  <div className="mb-0">
                    <label className="form-label">Cuerpo</label>
                    <textarea
                      className="form-control"
                      rows={8}
                      value={emailDraft.body}
                      onChange={(event) =>
                        setEmailDraft((prev) => (prev ? { ...prev, body: event.target.value } : prev))
                      }
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-primary" onClick={handleSendReport} disabled={isSending}>
                    {isSending ? 'Enviando...' : 'Enviar'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={closeSendReportModal}>
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

export default ReportListSection;
