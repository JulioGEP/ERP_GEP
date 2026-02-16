import { useMemo, useState } from 'react';
import { Alert, Form, Spinner, Table } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import { fetchPoDocuments } from './api/poDocuments.api';

function toDateInputValue(value: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function PoDocumentsTable() {
  const [documentNameFilter, setDocumentNameFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [sessionDateFilter, setSessionDateFilter] = useState('');

  const query = useQuery({
    queryKey: ['po-documents'],
    queryFn: fetchPoDocuments,
  });

  const filteredRows = useMemo(() => {
    const rows = Array.isArray(query.data) ? query.data : [];
    const normalizedDocumentNameFilter = documentNameFilter.trim().toLocaleLowerCase('es-ES');
    const normalizedCompanyFilter = companyFilter.trim().toLocaleLowerCase('es-ES');
    const normalizedSessionFilter = sessionFilter.trim().toLocaleLowerCase('es-ES');

    return rows.filter((row) => {
      if (
        normalizedDocumentNameFilter.length &&
        !row.nombreDocumento.toLocaleLowerCase('es-ES').includes(normalizedDocumentNameFilter)
      ) {
        return false;
      }

      if (normalizedCompanyFilter.length) {
        const company = (row.empresa ?? '').toLocaleLowerCase('es-ES');
        if (!company.includes(normalizedCompanyFilter)) {
          return false;
        }
      }

      if (normalizedSessionFilter.length) {
        const sessionName = (row.sesion ?? '').toLocaleLowerCase('es-ES');
        if (!sessionName.includes(normalizedSessionFilter)) {
          return false;
        }
      }

      if (sessionDateFilter.length) {
        return toDateInputValue(row.fechaSesion) === sessionDateFilter;
      }

      return true;
    });
  }, [query.data, documentNameFilter, companyFilter, sessionFilter, sessionDateFilter]);

  if (query.isLoading) {
    return (
      <div className="d-flex align-items-center gap-2 text-muted">
        <Spinner animation="border" size="sm" role="status" />
        <span>Cargando documentos PO…</span>
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert variant="danger" className="mb-0">
        No se pudo cargar el listado de documentos PO.
      </Alert>
    );
  }

  return (
    <div className="d-grid gap-3">
      <div className="d-grid gap-2">
        <div className="row g-2">
          <div className="col-12 col-md-6 col-xl-3">
            <Form.Group controlId="po-filter-document-name">
              <Form.Label>Nombre del documento</Form.Label>
              <Form.Control
                value={documentNameFilter}
                onChange={(event) => setDocumentNameFilter(event.target.value)}
                placeholder="Filtrar por documento"
              />
            </Form.Group>
          </div>

          <div className="col-12 col-md-6 col-xl-3">
            <Form.Group controlId="po-filter-company">
              <Form.Label>Empresa</Form.Label>
              <Form.Control
                value={companyFilter}
                onChange={(event) => setCompanyFilter(event.target.value)}
                placeholder="Filtrar por empresa"
              />
            </Form.Group>
          </div>

          <div className="col-12 col-md-6 col-xl-3">
            <Form.Group controlId="po-filter-session">
              <Form.Label>Sesión</Form.Label>
              <Form.Control
                value={sessionFilter}
                onChange={(event) => setSessionFilter(event.target.value)}
                placeholder="Filtrar por sesión"
              />
            </Form.Group>
          </div>

          <div className="col-12 col-md-6 col-xl-3">
            <Form.Group controlId="po-filter-date">
              <Form.Label>Fecha de la sesión</Form.Label>
              <Form.Control
                type="date"
                value={sessionDateFilter}
                onChange={(event) => setSessionDateFilter(event.target.value)}
              />
            </Form.Group>
          </div>
        </div>
      </div>

      <div className="table-responsive">
        <Table striped hover className="align-middle mb-0">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Sesión</th>
              <th>Fecha de sesión</th>
              <th>Empresa</th>
            </tr>
          </thead>
          <tbody>
            {!filteredRows.length ? (
              <tr>
                <td colSpan={4} className="text-muted text-center py-4">
                  No hay documentos PO que coincidan con los filtros aplicados.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.enlaceDocumento ? (
                      <a href={row.enlaceDocumento} target="_blank" rel="noreferrer">
                        {row.nombreDocumento}
                      </a>
                    ) : (
                      row.nombreDocumento
                    )}
                  </td>
                  <td>{row.sesion ?? '—'}</td>
                  <td>{formatDate(row.fechaSesion)}</td>
                  <td>{row.empresa ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
