import { useCallback, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, ListGroup, Spinner, Stack } from 'react-bootstrap';
import * as XLSX from 'xlsx';
import { importSessions, type SessionImportResponse, type SessionImportRow } from './sessions-import.api';
import { ApiError } from '../../api/client';

type UploadState = 'idle' | 'processing' | 'uploading';

type UploadResult = SessionImportResponse | null;

type ParsedRow = SessionImportRow & { rawIndex: number };

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseSheet(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        const parsed: ParsedRow[] = rows.map((row, index) => ({
          rawIndex: index,
          deal_id: normalizeCell(row.deal_id),
          deal_product_id: normalizeCell(row.deal_product_id),
          fecha_inicio_utc: normalizeCell(row.fecha_inicio_utc),
          fecha_fin_utc: normalizeCell(row.fecha_fin_utc),
          trainer_id: normalizeCell(row.trainer_id),
          estado: normalizeCell(row.estado),
        }));
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}

export function BulkSessionImportView() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [state, setState] = useState<UploadState>('idle');
  const [result, setResult] = useState<UploadResult>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pendingCount = useMemo(() => parsedRows.length, [parsedRows]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setResult(null);
    setErrorMessage(null);
    if (!file) {
      setParsedRows([]);
      return;
    }

    setState('processing');
    try {
      const rows = await parseSheet(file);
      setParsedRows(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo leer el fichero.';
      setErrorMessage(message);
      setParsedRows([]);
    }
    setState('idle');
  }, []);

  const handleUpload = useCallback(async () => {
    if (!parsedRows.length) return;
    setState('uploading');
    setErrorMessage(null);
    setResult(null);

    try {
      const payload: SessionImportRow[] = parsedRows.map((row) => ({
        deal_id: row.deal_id,
        deal_product_id: row.deal_product_id,
        fecha_inicio_utc: row.fecha_inicio_utc || undefined,
        fecha_fin_utc: row.fecha_fin_utc || undefined,
        trainer_id: row.trainer_id || undefined,
        estado: row.estado || undefined,
      }));
      const response = await importSessions(payload);
      setResult(response);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `[${error.code}] ${error.message}`
          : 'No se pudo importar el fichero. Inténtalo de nuevo.';
      setErrorMessage(message);
    }

    setState('idle');
  }, [parsedRows]);

  const isProcessing = state === 'processing';
  const isUploading = state === 'uploading';

  return (
    <Stack gap={4}>
      <div>
        <h1 className="h3">Importar sesiones por Excel</h1>
        <p className="text-muted mb-0">
          Sube un fichero con las columnas <code>deal_id</code>, <code>deal_product_id</code>,{' '}
          <code>fecha_inicio_utc</code>, <code>fecha_fin_utc</code>, <code>trainer_id</code> y{' '}
          <code>estado</code>. Cada fila se convertirá en una sesión nueva con sala aleatoria y la unidad móvil
          fija.
        </p>
      </div>

      <Card>
        <Card.Body className="d-flex flex-column gap-3">
          <div className="d-flex flex-column gap-2">
            <label htmlFor="session-import-file" className="fw-semibold">
              Fichero Excel
            </label>
            <input
              id="session-import-file"
              type="file"
              accept=".xls,.xlsx"
              onChange={handleFileChange}
              disabled={isProcessing || isUploading}
            />
            {selectedFile && (
              <div className="text-muted small">
                {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
              </div>
            )}
            {isProcessing && (
              <div className="text-info d-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" />
                <span>Procesando fichero…</span>
              </div>
            )}
          </div>

          <div className="d-flex gap-2 flex-wrap">
            <Button onClick={handleUpload} disabled={!pendingCount || isProcessing || isUploading}>
              Importar sesiones
            </Button>
            {isUploading && (
              <Badge bg="info" text="dark">
                Subiendo sesiones…
              </Badge>
            )}
          </div>

          {pendingCount > 0 && (
            <Alert variant="secondary" className="mb-0">
              Total de filas detectadas: <strong>{pendingCount}</strong>.
            </Alert>
          )}
          {errorMessage && (
            <Alert variant="danger" className="mb-0">
              {errorMessage}
            </Alert>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <h2 className="h5">Resultado</h2>
          {!result ? (
            <Alert variant="secondary" className="mb-0">
              Sube un Excel y pulsa «Importar sesiones» para ver el resumen de la carga.
            </Alert>
          ) : (
            <Stack gap={3}>
              <Alert variant="light" className="mb-0">
                <div className="fw-semibold mb-1">Resumen</div>
                <div className="d-flex gap-3 flex-wrap">
                  <span>Total filas: {result.summary.total}</span>
                  <span className="text-success">Correctas: {result.summary.successes}</span>
                  <span className="text-danger">Errores: {result.summary.errors}</span>
                </div>
              </Alert>
              <ListGroup variant="flush">
                {result.results.map((row) => (
                  <ListGroup.Item key={`${row.index}-${row.deal_id}-${row.deal_product_id}`}>
                    <div className="d-flex justify-content-between flex-column flex-md-row">
                      <div className="me-3">
                        <div className="fw-semibold">
                          Presupuesto {row.deal_id ?? '—'} · Producto {row.deal_product_id ?? '—'}
                        </div>
                        <div className="text-muted small mt-1">{row.message}</div>
                        {row.session_id && (
                          <div className="text-muted small">Sesión creada: {row.session_id}</div>
                        )}
                      </div>
                      <Badge bg={row.status === 'success' ? 'success' : 'danger'}>
                        {row.status === 'success' ? 'Correcto' : 'Error'}
                      </Badge>
                    </div>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Stack>
          )}
        </Card.Body>
      </Card>
    </Stack>
  );
}

export default BulkSessionImportView;

