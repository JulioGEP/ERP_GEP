import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Button, Card, Form, Spinner } from 'react-bootstrap';

import { ApiError, uploadSessionCertificate } from '../presupuestos/api';
import { useCertificateData } from './hooks/useCertificateData';
import { CertificateTable } from './CertificateTable';
import { CertificateToolbar, type CertificateToolbarProgressStatus } from './CertificateToolbar';
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
  } = useCertificateData();

  const [editableRows, setEditableRows] = useState<CertificateRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationTotal, setGenerationTotal] = useState(0);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationResults, setGenerationResults] = useState<GenerationResult[]>([]);
  const [generationSteps, setGenerationSteps] = useState<GenerationStep[]>(() => createGenerationSteps());
  const [isCancellingGeneration, setIsCancellingGeneration] = useState(false);
  const certificateModulePromiseRef = useRef<Promise<CertificatePdfModule | null> | null>(null);
  const generationAbortRef = useRef<{ cancelled: boolean } | null>(null);

  const resetGenerationSteps = useCallback(() => {
    setGenerationSteps(createGenerationSteps());
  }, [setGenerationSteps]);

  const setGenerationStepStatus = useCallback(
    (stepId: GenerationStepId, status: GenerationStepStatus) => {
      setGenerationSteps((current) =>
        current.map((step) => (step.id === stepId ? { ...step, status } : step)),
      );
    },
    [setGenerationSteps],
  );

  const ensureCertificateGenerator = useCallback(async (): Promise<CertificatePdfModule> => {
    const currentGenerator = window.certificatePdf;
    if (currentGenerator && typeof currentGenerator.generate === 'function') {
      return currentGenerator;
    }

    if (!certificateModulePromiseRef.current) {
      certificateModulePromiseRef.current = import('./lib/pdf/certificate-pdf')
        .then(() => window.certificatePdf ?? null)
        .catch((error) => {
          certificateModulePromiseRef.current = null;
          throw error;
        });
    }

    const loadedGenerator = await certificateModulePromiseRef.current;
    if (loadedGenerator && typeof loadedGenerator.generate === 'function') {
      return loadedGenerator;
    }

    certificateModulePromiseRef.current = null;
    throw new Error('El generador de certificados no está disponible.');
  }, []);

  useEffect(() => {
    setEditableRows(rows.map((row) => ({ ...row })));
  }, [rows]);

  useEffect(() => {
    setGenerationError(null);
    setGenerationProgress(0);
    setGenerationTotal(0);
    setGenerationResults([]);
    resetGenerationSteps();
  }, [selectedSessionId, resetGenerationSteps]);

  useEffect(() => {
    void ensureCertificateGenerator().catch(() => {
      // The generator will be re-attempted when trying to generate certificates.
    });
  }, [ensureCertificateGenerator]);

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

      let pdfGenerator: CertificatePdfModule;
      try {
        throwIfCancelled();
        pdfGenerator = await ensureCertificateGenerator();
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
            const pdfRow = mapRowToPdfRow(row);
            const { blob, fileName } = await pdfGenerator.generate(pdfRow, { download: false });
            throwIfCancelled();
            if (!(blob instanceof Blob) || !blob.size) {
              throw new Error('El certificado generado está vacío.');
            }

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

            return { id: row.id, label: studentLabel, status: 'success' };
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
          await selectSession(sessionId);
          throwIfCancelled();
          setGenerationStepStatus('refreshStudents', 'success');
        } catch (reloadError) {
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
      deal?.deal_id,
      selectedSessionId,
      editableRows,
      selectSession,
      ensureCertificateGenerator,
      resetGenerationSteps,
      setGenerationStepStatus,
    ],
  );

  const handleGenerateCertificates = useCallback(() => {
    void runCertificateGeneration({ resetResults: true });
  }, [runCertificateGeneration]);

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

  const incompleteRows = useMemo(
    () => editableRows.filter((row) => !isRowComplete(row)),
    [editableRows],
  );
  const hasIncompleteRows = incompleteRows.length > 0;
  const hasDealId = Boolean(deal?.deal_id);
  const hasSelectedSession = Boolean(selectedSessionId);
  const showSessionsSelect = sessions.length > 1;
  const showAutoSelectedSession = sessions.length === 1 && selectedSession;
  const hasResults = editableRows.length > 0;
  const hasVisibleStepProgress = generationSteps.some((step) => step.status !== 'pending');
  const isToolbarDisabled =
    !hasResults ||
    loadingStudents ||
    generating ||
    !hasDealId ||
    !hasSelectedSession ||
    hasIncompleteRows;

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

  return (
    <div className="d-flex justify-content-center">
      <Card className="shadow-sm border-0 w-100" style={{ maxWidth: '1248px' }}>
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
                <Alert
                  variant={hasGenerationFailures ? 'warning' : 'success'}
                  className="text-start mt-3"
                >
                  {hasGenerationFailures
                    ? `Se generaron ${generationSummary.successCount} de ${generationSummary.total} certificados. Revisa el detalle para ver los alumnos con incidencias.`
                    : 'Se generaron todos los certificados correctamente.'}
                </Alert>
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
                          <div className="fw-semibold">{result.label}</div>
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
    </div>
  );
}
