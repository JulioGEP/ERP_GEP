import { useState } from 'react';
import { Alert, Badge, Button, Card, Form, ListGroup, Stack, Table } from 'react-bootstrap';

import { ApiError } from '../../api/client';
import type { BulkSessionImportRow, BulkSessionImportResponse } from './bulkSessionsImport.api';
import { importSessionsFromExcel } from './bulkSessionsImport.api';

function ResultStatusBadge({ status }: { status: BulkSessionImportRow['status'] }) {
  const variant = status === 'created' ? 'success' : 'danger';
  const label = status === 'created' ? 'Creada' : 'Error';

  return <Badge bg={variant}>{label}</Badge>;
}

export function BulkSessionsImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [results, setResults] = useState<BulkSessionImportRow[]>([]);
  const [summary, setSummary] = useState<BulkSessionImportResponse['summary'] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || isUploading) return;

    setIsUploading(true);
    setErrorMessage(null);
    setResults([]);
    setSummary(null);

    try {
      const response = await importSessionsFromExcel(file);
      setResults(response.results);
      setSummary(response.summary);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo importar el fichero.';
      setErrorMessage(message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Stack gap={4}>
      <div>
        <h1 className="h3 mb-2">Importar sesiones en bloque</h1>
        <p className="text-muted mb-0">
          Sube un Excel con las columnas necesarias y se crearán las sesiones asociadas a cada presupuesto y
          línea de producto.
        </p>
      </div>

      <Card>
        <Card.Body>
          <h2 className="h5">Columnas esperadas</h2>
          <p className="text-muted mb-3">
            La primera hoja del Excel se procesa fila a fila. Las cabeceras pueden ir en minúsculas o mayúsculas.
          </p>
          <ListGroup as="ul" className="mb-0">
            <ListGroup.Item as="li">
              <strong>deal_id</strong>: identificador del presupuesto (obligatorio).
            </ListGroup.Item>
            <ListGroup.Item as="li">
              <strong>deal_product_id</strong>: identificador de la línea de producto (obligatorio).
            </ListGroup.Item>
            <ListGroup.Item as="li">
              <strong>fecha_inicio_utc</strong> y <strong>fecha_fin_utc</strong>: fecha y hora en formato ISO con zona
              horaria, por ejemplo <code>2024-07-15T08:30:00Z</code>. Si solo pones la fecha (p. ej.
              <code>2024-07-15</code>) se tomará medianoche UTC.
            </ListGroup.Item>
            <ListGroup.Item as="li">
              <strong>direccion</strong> y <strong>sala_id</strong>: opcionales. Si faltan, se usa la dirección por defecto
              del presupuesto.
            </ListGroup.Item>
            <ListGroup.Item as="li">
              <strong>trainer_ids</strong> y <strong>unidad_movil_ids</strong>: listas separadas por comas o punto y coma.
            </ListGroup.Item>
            <ListGroup.Item as="li">
              <strong>force_estado_borrador</strong>: cualquier valor verdadero (true, 1, yes) fuerza el estado BORRADOR.
            </ListGroup.Item>
          </ListGroup>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
            <Form.Group controlId="bulk-sessions-file">
              <Form.Label>Fichero Excel</Form.Label>
              <Form.Control
                type="file"
                accept=".xlsx,.xls"
                disabled={isUploading}
                onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
              />
              <Form.Text className="text-muted">
                Se procesará la primera hoja del fichero. Las filas sin <code>deal_id</code> o{' '}
                <code>deal_product_id</code> se marcarán como error.
              </Form.Text>
            </Form.Group>

            <div className="d-flex gap-2 flex-wrap">
              <Button type="submit" disabled={!file || isUploading}>
                {isUploading ? 'Importando…' : 'Importar sesiones'}
              </Button>
              {summary && (
                <Badge bg={summary.failed ? 'warning' : 'success'}>
                  Total: {summary.total} · Creadas: {summary.created} · Errores: {summary.failed}
                </Badge>
              )}
            </div>

            {errorMessage && (
              <Alert variant="danger" className="mb-0">
                {errorMessage}
              </Alert>
            )}
          </Form>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <h2 className="h5">Resultado</h2>
          {!results.length ? (
            <Alert variant="secondary" className="mb-0">
              Aún no hay resultados. Sube un Excel y pulsa «Importar sesiones».
            </Alert>
          ) : (
            <div className="table-responsive mt-3">
              <Table hover bordered size="sm" className="align-middle mb-0">
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Fila</th>
                    <th>Presupuesto (deal_id)</th>
                    <th>Producto (deal_product_id)</th>
                    <th>Sesión creada</th>
                    <th>Estado</th>
                    <th>Mensaje</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr key={`${row.row}-${row.deal_id ?? 'sin-deal'}-${row.deal_product_id ?? 'sin-producto'}`}>
                      <td>{row.row}</td>
                      <td>{row.deal_id ?? '—'}</td>
                      <td>{row.deal_product_id ?? '—'}</td>
                      <td>{row.session_id ?? '—'}</td>
                      <td>
                        <ResultStatusBadge status={row.status} />
                      </td>
                      <td>{row.message ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>
    </Stack>
  );
}

export default BulkSessionsImportView;
