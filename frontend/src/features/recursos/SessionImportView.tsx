import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Form, Stack, Table } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import { blobOrFileToBase64 } from '../../utils/base64';
import { importSessionsFromExcel, type SessionImportResult } from './sessionsImport.api';

const DEFAULT_ERROR_MESSAGE = 'No se pudo importar el Excel. Inténtalo de nuevo más tarde.';

export function SessionImportView() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<SessionImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const totalRows = useMemo(() => {
    if (!result) return 0;
    return result.results.length;
  }, [result]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedFile) {
        setErrorMessage('Selecciona un archivo Excel antes de importar.');
        return;
      }

      setErrorMessage(null);
      setResult(null);
      setIsUploading(true);

      try {
        const base64 = await blobOrFileToBase64(selectedFile);
        const response = await importSessionsFromExcel(base64);
        setResult(response);
      } catch (error) {
        const message = error instanceof ApiError ? error.message || DEFAULT_ERROR_MESSAGE : DEFAULT_ERROR_MESSAGE;
        setErrorMessage(message);
      } finally {
        setIsUploading(false);
      }
    },
    [selectedFile],
  );

  const renderResultTable = () => {
    if (!result) return null;
    if (!result.results.length) {
      return <Alert variant="secondary" className="mb-0">No se devolvieron filas procesadas.</Alert>;
    }

    return (
      <Table responsive hover className="mb-0">
        <thead>
          <tr>
            <th style={{ width: '120px' }}>Fila</th>
            <th style={{ width: '140px' }}>Estado</th>
            <th>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {result.results.map((entry) => {
            const isError = Boolean(entry.error);
            return (
              <tr key={entry.row} className={isError ? 'table-danger' : 'table-success'}>
                <td>#{entry.row}</td>
                <td>
                  <Badge bg={isError ? 'danger' : 'success'}>{isError ? 'Error' : 'Importada'}</Badge>
                </td>
                <td>
                  {entry.error ? (
                    <span>{entry.error}</span>
                  ) : (
                    <span>Sesión creada con ID {entry.sessionId ?? 'desconocido'}.</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    );
  };

  return (
    <Stack gap={4}>
      <div>
        <h1 className="h3 mb-2">Importar sesiones desde Excel</h1>
        <p className="text-muted mb-0">
          Sube un archivo Excel con las columnas esperadas por la función de importación y procesaremos todas las filas
          para crear o actualizar sesiones.
        </p>
      </div>

      <Card>
        <Card.Body>
          <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
            <Form.Group controlId="session-import-file">
              <Form.Label>Archivo Excel</Form.Label>
              <Form.Control
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                disabled={isUploading}
              />
              <Form.Text className="text-muted">
                Solo se acepta un archivo Excel. El contenido se envía codificado en base64.
              </Form.Text>
            </Form.Group>

            {errorMessage && (
              <Alert variant="danger" className="mb-0">
                {errorMessage}
              </Alert>
            )}

            <div className="d-flex gap-2 flex-wrap align-items-center">
              <Button type="submit" disabled={!selectedFile || isUploading}>
                {isUploading ? 'Importando…' : 'Importar sesiones'}
              </Button>
              {selectedFile && !isUploading && (
                <Badge bg="secondary">Archivo seleccionado: {selectedFile.name}</Badge>
              )}
              {isUploading && <Badge bg="info" text="dark">Procesando archivo...</Badge>}
            </div>
          </Form>
        </Card.Body>
      </Card>

      {result && (
        <Card>
          <Card.Body className="d-flex flex-column gap-3">
            <div>
              <h2 className="h5 mb-1">Resultado de la importación</h2>
              <div className="text-muted small">
                Importadas: {result.imported} · Errores: {result.failed} · Filas procesadas: {totalRows}
              </div>
            </div>
            {renderResultTable()}
          </Card.Body>
        </Card>
      )}
    </Stack>
  );
}

export default SessionImportView;
