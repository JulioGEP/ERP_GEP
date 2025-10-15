import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Spinner } from 'react-bootstrap';

import { ApiError, updateSessionStudent, uploadSessionCertificate } from '../presupuestos/api';
import { useCertificateData } from './hooks/useCertificateData';
import { CertificateTable } from './CertificateTable';
import { CertificateToolbar } from './CertificateToolbar';
import type { CertificateRow, CertificateSession } from './lib/mappers';

import './styles/certificados.scss';

type CertificatePdfRowInput = {
  nombre?: string;
  apellido?: string;
  dni?: string;
  documentType?: string;
  fecha?: string;
  segundaFecha?: string;
  lugar?: string;
  duracion?: string | number;
  formacion?: string;
  cliente?: string;
  irata?: string;
};

type CertificatePdfModule = {
  generate: (
    row: CertificatePdfRowInput,
    options?: { download?: boolean },
  ) => Promise<{ fileName: string; blob: Blob }>;
};

declare global {
  interface Window {
    certificatePdf?: CertificatePdfModule;
  }
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

function mapRowToPdfRow(row: CertificateRow): CertificatePdfRowInput {
  const documentType = row.dni?.trim() ? 'DNI' : undefined;
  return {
    nombre: row.nombre,
    apellido: row.apellidos,
    dni: row.dni,
    documentType,
    fecha: row.fecha,
    segundaFecha: row.fecha2,
    lugar: row.lugar,
    duracion: row.horas,
    formacion: row.formacion,
    cliente: row.cliente,
    irata: row.irata,
  };
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

function toNonEmptyString(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function resolveGenerationError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
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
  } = useCertificateData();

  const [editableRows, setEditableRows] = useState<CertificateRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationTotal, setGenerationTotal] = useState(0);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationSuccess, setGenerationSuccess] = useState(false);

  useEffect(() => {
    setEditableRows(rows.map((row) => ({ ...row })));
  }, [rows]);

  useEffect(() => {
    setGenerationError(null);
    setGenerationSuccess(false);
    setGenerationProgress(0);
    setGenerationTotal(0);
  }, [selectedSessionId]);

  const handleRowsChange = useCallback((nextRows: CertificateRow[]) => {
    setEditableRows(nextRows);
  }, []);

  const handleGenerateCertificates = useCallback(async () => {
    const dealId = deal?.deal_id ? String(deal.deal_id).trim() : '';
    const sessionId = selectedSessionId ? String(selectedSessionId).trim() : '';
    const rowsToProcess = editableRows.slice();
    const pdfGenerator = window.certificatePdf;

    if (!dealId) {
      setGenerationError('Selecciona un deal válido antes de generar certificados.');
      return;
    }

    if (!sessionId) {
      setGenerationError('Selecciona una sesión antes de generar certificados.');
      return;
    }

    if (!rowsToProcess.length) {
      setGenerationError('No hay alumnos disponibles para generar certificados.');
      return;
    }

    if (!pdfGenerator || typeof pdfGenerator.generate !== 'function') {
      setGenerationError('El generador de certificados no está disponible.');
      return;
    }

    setGenerationError(null);
    setGenerationSuccess(false);
    setGenerationProgress(0);
    setGenerationTotal(rowsToProcess.length);
    setGenerating(true);

    try {
      for (let index = 0; index < rowsToProcess.length; index += 1) {
        const row = rowsToProcess[index];
        try {
          const pdfRow = mapRowToPdfRow(row);
          const { blob, fileName } = await pdfGenerator.generate(pdfRow, { download: false });
          if (!(blob instanceof Blob) || !blob.size) {
            throw new Error('El certificado generado está vacío.');
          }

          const uploadResult = await uploadSessionCertificate({
            dealId,
            sessionId,
            studentId: row.id,
            fileName,
            file: blob,
          });

          const publicUrl =
            toNonEmptyString(uploadResult.publicUrl) ??
            toNonEmptyString(uploadResult.student?.drive_url ?? null);

          const updatedStudent = await updateSessionStudent(row.id, {
            certificado: true,
            drive_url: publicUrl,
          });

          const resolvedUrl =
            toNonEmptyString(updatedStudent.drive_url) ?? publicUrl ?? row.driveUrl ?? null;

          setEditableRows((current) =>
            current.map((item) =>
              item.id === row.id
                ? { ...item, certificado: true, driveUrl: resolvedUrl }
                : item,
            ),
          );

          setGenerationProgress(index + 1);
        } catch (error) {
          const studentLabel = buildStudentDisplayName(row);
          const message = resolveGenerationError(error);
          throw new Error(`No se pudo generar el certificado de ${studentLabel}. ${message}`);
        }
      }

      await selectSession(sessionId);
      setGenerationSuccess(true);
    } catch (error) {
      const message = resolveGenerationError(error);
      setGenerationError(message);

      if (sessionId) {
        try {
          await selectSession(sessionId);
        } catch (reloadError) {
          const reloadMessage = resolveGenerationError(reloadError);
          setGenerationError((currentMessage) => {
            if (currentMessage && currentMessage.includes(reloadMessage)) {
              return currentMessage;
            }
            return `${currentMessage ?? message} Además, no se pudo recargar el listado de alumnos (${reloadMessage}).`;
          });
        }
      }
    } finally {
      setGenerating(false);
    }
  }, [deal?.deal_id, selectedSessionId, editableRows, selectSession]);

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

  const showSessionsSelect = sessions.length > 1;
  const showAutoSelectedSession = sessions.length === 1 && selectedSession;
  const hasResults = editableRows.length > 0;
  const isToolbarDisabled = !hasResults || loadingStudents || generating;

  return (
    <div className="d-flex justify-content-center">
      <Card className="shadow-sm border-0 w-100" style={{ maxWidth: '960px' }}>
        <Card.Body className="p-4">
          <Card.Title as="h1" className="h4 fw-bold mb-4 text-uppercase text-center">
            Certificados
          </Card.Title>

          <Form onSubmit={handleSubmit} className="mb-4">
            <Form.Group controlId="certificate-deal" className="text-start">
              <Form.Label>Introduce el número de deal</Form.Label>
              <div className="d-flex gap-2">
                <Form.Control
                  type="text"
                  placeholder="Ej. 1234"
                  value={dealIdInput}
                  onChange={(event) => setDealIdInput(event.target.value)}
                  disabled={loadingDeal}
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
              <CertificateToolbar
                onGenerate={handleGenerateCertificates}
                disabled={isToolbarDisabled}
                loading={generating}
                progress={generationProgress}
                total={generationTotal}
              />
              <CertificateTable
                rows={editableRows}
                onRowsChange={handleRowsChange}
                disabled={loadingStudents || generating}
              />
              {generationError && (
                <Alert variant="danger" className="text-start mt-3">
                  {generationError}
                </Alert>
              )}
              {generationSuccess && !generationError && (
                <Alert variant="success" className="text-start mt-3">
                  Certificados generados correctamente.
                </Alert>
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
    </div>
  );
}
