import { useCallback, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Form, ListGroup, Stack, Table } from 'react-bootstrap';
import { read, utils } from 'xlsx';
import { ApiError } from '../../api/client';
import { importSessionBatch } from './session-import.api';

type ImportStatus = 'pending' | 'uploading' | 'success' | 'error';

type ParsedSessionRow = {
  dealId: string;
  sessionNumber: string;
  start: string;
  end: string;
  trainer: string;
  trainerSup: string;
  estado: string;
};

type SessionImportProgress = {
  dealId: string;
  status: ImportStatus;
  message?: string;
  created?: number;
  updated?: number;
  removed?: number;
};

const STATUS_VARIANTS: Record<ImportStatus, string> = {
  pending: 'secondary',
  uploading: 'info',
  success: 'success',
  error: 'danger',
};

const STATUS_LABELS: Record<ImportStatus, string> = {
  pending: 'Pendiente',
  uploading: 'Procesando',
  success: 'OK',
  error: 'Error',
};

function normalizeHeader(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function getCellValue(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      const value = String(row[key]).trim();
      if (value.length) return value;
    }
  }
  return '';
}

function mapRow(raw: Record<string, any>): ParsedSessionRow | null {
  const normalizedEntries = Object.entries(raw).reduce<Record<string, any>>((acc, [key, value]) => {
    acc[normalizeHeader(key)] = value;
    return acc;
  }, {});

  const dealId = getCellValue(normalizedEntries, ['deal_id_pipedrive', 'deal', 'presupuesto']);
  const sessionNumber = getCellValue(normalizedEntries, ['num_sesion', 'sesion']);
  const start = getCellValue(normalizedEntries, ['inicio', 'start']);
  const end = getCellValue(normalizedEntries, ['fin', 'end']);
  const trainer = getCellValue(normalizedEntries, ['formador', 'trainer']);
  const trainerSup = getCellValue(normalizedEntries, ['formador_sup', 'formador_suplente', 'trainer_sup']);
  const estado = getCellValue(normalizedEntries, ['estado_de_la_sesion', 'estado', 'status']);

  if (!dealId || !sessionNumber || !start || !end) return null;

  return { dealId, sessionNumber, start, end, trainer, trainerSup, estado };
}

export function SessionBulkImportView() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedSessionRow[]>([]);
  const [progress, setProgress] = useState<SessionImportProgress[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupedByDeal = useMemo(() => {
    return parsedRows.reduce<Record<string, ParsedSessionRow[]>>((acc, row) => {
      if (!acc[row.dealId]) acc[row.dealId] = [];
      acc[row.dealId].push(row);
      return acc;
    }, {});
  }, [parsedRows]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setParsedRows([]);
    setProgress([]);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
      const mapped = json
        .map(mapRow)
        .filter((row): row is ParsedSessionRow => Boolean(row));

      if (!mapped.length) {
        setError('No se encontraron filas válidas en el Excel. Revisa los nombres de las columnas.');
        return;
      }

      setParsedRows(mapped);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo leer el archivo Excel.';
      setError(message);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    setIsRunning(true);
    setError(null);
    setProgress(
      Object.keys(groupedByDeal).map((dealId) => ({
        dealId,
        status: 'pending',
        message: 'Pendiente de envío',
      })),
    );

    for (const dealId of Object.keys(groupedByDeal)) {
      setProgress((current) =>
        current.map((item) =>
          item.dealId === dealId
            ? { ...item, status: 'uploading', message: 'Creando sesión…' }
            : item,
        ),
      );

      try {
        const result = await importSessionBatch({
          dealId,
          rows: groupedByDeal[dealId],
        });

        setProgress((current) =>
          current.map((item) =>
            item.dealId === dealId
              ? {
                  ...item,
                  status: 'success',
                  message: result.message ?? 'Sesiones procesadas',
                  created: result.created,
                  updated: result.updated,
                  removed: result.removed,
                }
              : item,
          ),
        );
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'No se pudieron importar las sesiones.';
        setProgress((current) =>
          current.map((item) =>
            item.dealId === dealId ? { ...item, status: 'error', message } : item,
          ),
        );
      }
    }

    setIsRunning(false);
  }, [groupedByDeal]);

  return (
    <Stack gap={4}>
      <div>
        <h1 className="h3 mb-2">Importar sesiones</h1>
        <p className="text-muted mb-0">
          Sube un Excel con los campos del presupuesto y se crearán o eliminarán sesiones siguiendo el orden indicado.
        </p>
      </div>

      <Card>
        <Card.Body className="d-flex flex-column gap-3">
          <div>
            <Form.Label className="fw-semibold">Archivo Excel</Form.Label>
            <Form.Control type="file" accept=".xls,.xlsx" onChange={handleFileChange} disabled={isRunning} />
            <Form.Text className="text-muted">
              Columnas esperadas: deal_id_pipedrive, num_sesion, inicio, fin, formador, formador_sup, estado de la sesión.
            </Form.Text>
          </div>

          {fileName && (
            <Alert variant="info" className="mb-0">
              <div className="fw-semibold">Archivo seleccionado:</div>
              <div>{fileName}</div>
            </Alert>
          )}

          {error && (
            <Alert variant="danger" className="mb-0">
              {error}
            </Alert>
          )}

          {parsedRows.length > 0 && (
            <div>
              <div className="d-flex align-items-center justify-content-between mb-2">
                <div className="fw-semibold">Sesiones detectadas</div>
                <div className="text-muted small">Total filas: {parsedRows.length}</div>
              </div>
              <div className="table-responsive">
                <Table striped bordered hover size="sm" className="mb-0">
                  <thead>
                    <tr>
                      <th>Presupuesto</th>
                      <th>Sesión</th>
                      <th>Inicio</th>
                      <th>Fin</th>
                      <th>Formador</th>
                      <th>Formador suplente</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 25).map((row, index) => (
                      <tr key={`${row.dealId}-${row.sessionNumber}-${index}`}>
                        <td>{row.dealId}</td>
                        <td>{row.sessionNumber}</td>
                        <td>{row.start}</td>
                        <td>{row.end}</td>
                        <td>{row.trainer || '—'}</td>
                        <td>{row.trainerSup || '—'}</td>
                        <td>{row.estado || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {parsedRows.length > 25 && (
                <div className="text-muted small mt-1">Mostrando las primeras 25 filas.</div>
              )}
            </div>
          )}

          <div className="d-flex gap-2 flex-wrap">
            <Button onClick={handleSubmit} disabled={!parsedRows.length || isRunning}>
              Importar sesiones
            </Button>
            {isRunning && (
              <Badge bg="info" text="dark">
                Procesando importaciones...
              </Badge>
            )}
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <h2 className="h5">Seguimiento</h2>
          {!progress.length ? (
            <Alert variant="secondary" className="mb-0">
              Carga un archivo y pulsa "Importar sesiones" para comenzar.
            </Alert>
          ) : (
            <ListGroup variant="flush" className="mt-3">
              {progress.map((item) => (
                <ListGroup.Item key={item.dealId} className="d-flex flex-column flex-md-row gap-2">
                  <div className="flex-grow-1">
                    <div className="fw-semibold">Presupuesto {item.dealId}</div>
                    {item.message && <div className="text-muted small mt-1">{item.message}</div>}
                    {(item.created ?? 0) + (item.updated ?? 0) + (item.removed ?? 0) > 0 && (
                      <div className="small mt-1">
                        <Badge bg="success" className="me-2">ok</Badge>
                        <span className="me-2">Creadas: {item.created ?? 0}</span>
                        <span className="me-2">Actualizadas: {item.updated ?? 0}</span>
                        <span className="me-2">Eliminadas: {item.removed ?? 0}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 mt-md-0">
                    <Badge bg={STATUS_VARIANTS[item.status]}>{STATUS_LABELS[item.status]}</Badge>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Card.Body>
      </Card>
    </Stack>
  );
}

export default SessionBulkImportView;
