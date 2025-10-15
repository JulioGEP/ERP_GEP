import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Spinner } from 'react-bootstrap';

import { useCertificateData } from './hooks/useCertificateData';
import { CertificateTable } from './CertificateTable';
import { CertificateToolbar } from './CertificateToolbar';
import type { CertificateRow, CertificateSession } from './lib/mappers';

import './styles/certificados.scss';

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

  useEffect(() => {
    setEditableRows(rows.map((row) => ({ ...row })));
  }, [rows]);

  const handleRowsChange = useCallback((nextRows: CertificateRow[]) => {
    setEditableRows(nextRows);
  }, []);

  const handleGenerateCertificates = useCallback(() => {
    // La lógica de generación se implementará en tareas posteriores
  }, []);

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
  const isToolbarDisabled = !hasResults || loadingStudents;

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
              />
              <CertificateTable
                rows={editableRows}
                onRowsChange={handleRowsChange}
                disabled={loadingStudents}
              />
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
