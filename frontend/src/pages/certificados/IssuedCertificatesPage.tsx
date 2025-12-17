import { useMemo, useState } from 'react';
import { Button, Col, Container, Form, Row, Spinner, Table } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import {
  fetchIssuedCertificates,
  type IssuedCertificate,
  type IssuedCertificateFilters,
  type IssuedCertificatesResponse,
} from '../../api/issuedCertificates';

const PAGE_SIZE = 50;
const EMPTY_FILTERS: IssuedCertificateFilters = {
  alumno: '',
  empresa: '',
  fecha_formacion: '',
  formacion: '',
  presupuesto: '',
};

export default function IssuedCertificatesPage() {
  const [filters, setFilters] = useState<IssuedCertificateFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const queryKey = useMemo(() => ['issued-certificates', filters, page], [filters, page]);

  const { data, isLoading, isFetching, error } = useQuery<IssuedCertificatesResponse, Error>({
    queryKey,
    queryFn: () => fetchIssuedCertificates({ ...filters, page }),
  });

  const handleFiltersChange = (field: keyof IssuedCertificateFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
  };

  const handleReset = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const records: IssuedCertificate[] = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <Container fluid className="py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h1 className="h3 mb-0">Certificados emitidos</h1>
          <small className="text-muted">Listado paginado de certificados generados</small>
        </div>
        {isFetching && <Spinner animation="border" size="sm" role="status" />}
      </div>

      <Form onSubmit={handleSubmit} className="mb-3">
        <Row className="g-2 align-items-end">
          <Col md={2} sm={6} xs={12}>
            <Form.Label>Presupuesto</Form.Label>
            <Form.Control
              type="text"
              value={filters.presupuesto}
              onChange={(event) => handleFiltersChange('presupuesto', event.target.value)}
              placeholder="ID o referencia"
            />
          </Col>
          <Col md={3} sm={6} xs={12}>
            <Form.Label>Nombre / Apellido</Form.Label>
            <Form.Control
              type="text"
              value={filters.alumno}
              onChange={(event) => handleFiltersChange('alumno', event.target.value)}
              placeholder="Buscar alumno"
            />
          </Col>
          <Col md={2} sm={6} xs={12}>
            <Form.Label>Fecha de la formación</Form.Label>
            <Form.Control
              type="date"
              value={filters.fecha_formacion}
              onChange={(event) => handleFiltersChange('fecha_formacion', event.target.value)}
            />
          </Col>
          <Col md={2} sm={6} xs={12}>
            <Form.Label>Empresa</Form.Label>
            <Form.Control
              type="text"
              value={filters.empresa}
              onChange={(event) => handleFiltersChange('empresa', event.target.value)}
              placeholder="Organización"
            />
          </Col>
          <Col md={2} sm={6} xs={12}>
            <Form.Label>Formación</Form.Label>
            <Form.Control
              type="text"
              value={filters.formacion}
              onChange={(event) => handleFiltersChange('formacion', event.target.value)}
              placeholder="Curso"
            />
          </Col>
          <Col md={1} sm={6} xs={12} className="d-flex gap-2">
            <Button type="submit" variant="primary" className="w-100">
              Filtrar
            </Button>
          </Col>
          <Col md={1} sm={6} xs={12} className="d-flex gap-2">
            <Button variant="outline-secondary" className="w-100" onClick={handleReset}>
              Limpiar
            </Button>
          </Col>
        </Row>
      </Form>

      {error && <div className="text-danger mb-3">{error.message}</div>}

      <div className="table-responsive">
        <Table striped bordered hover size="sm">
          <thead>
            <tr>
              <th>Presupuesto</th>
              <th>Nombre / Apellido del alumno</th>
              <th>Fecha de la formación</th>
              <th>Empresa</th>
              <th>Formación</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="text-center py-4">
                  <Spinner animation="border" role="status" />
                </td>
              </tr>
            )}

            {!isLoading && records.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-4 text-muted">
                  No hay certificados emitidos con los filtros seleccionados.
                </td>
              </tr>
            )}

            {records.map((record) => (
              <tr key={record.id}>
                <td>
                  <div className="fw-semibold">{record.presupuesto}</div>
                </td>
                <td>
                  {record.alumno_nombre} {record.alumno_apellido}
                </td>
                <td>{record.fecha_formacion ? record.fecha_formacion.slice(0, 10) : '—'}</td>
                <td>{record.empresa || '—'}</td>
                <td>{record.formacion || '—'}</td>
                <td>
                  {record.drive_url ? (
                    <a href={record.drive_url} target="_blank" rel="noreferrer">
                      Ver certificado
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {pagination && (
        <div className="d-flex justify-content-between align-items-center">
          <div className="text-muted">
            Página {pagination.page} de {Math.max(1, Math.ceil(pagination.total / PAGE_SIZE))} ·{' '}
            {pagination.total} resultados
          </div>
          <div className="d-flex gap-2">
            <Button
              variant="outline-secondary"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline-secondary"
              disabled={!pagination.hasMore || isFetching}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </Container>
  );
}
