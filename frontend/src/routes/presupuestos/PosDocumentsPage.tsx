import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Form, Spinner, Table } from 'react-bootstrap';
import { fetchPoDocuments } from '../../features/presupuestos/api/poDocuments.api';

function formatDate(dateIso: string | null): string {
  if (!dateIso) return '—';
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('es-ES');
}

function toDateInputValue(dateIso: string | null): string {
  if (!dateIso) return '';
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function PosDocumentsPage() {
  const [documentFilter, setDocumentFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [sessionDateFilter, setSessionDateFilter] = useState('');

  const documentsQuery = useQuery({
    queryKey: ['po-documents'],
    queryFn: fetchPoDocuments,
  });

  const documents = documentsQuery.data ?? [];

  const filteredDocuments = useMemo(() => {
    const normalizedDocument = documentFilter.trim().toLowerCase();
    const normalizedCompany = companyFilter.trim().toLowerCase();
    const normalizedSession = sessionFilter.trim().toLowerCase();

    return documents.filter((document) => {
      if (normalizedDocument && !document.name.toLowerCase().includes(normalizedDocument)) {
        return false;
      }

      const companyName = (document.companyName ?? '').toLowerCase();
      if (normalizedCompany && !companyName.includes(normalizedCompany)) {
        return false;
      }

      const sessionName = (document.sessionName ?? '').toLowerCase();
      if (normalizedSession && !sessionName.includes(normalizedSession)) {
        return false;
      }

      if (sessionDateFilter) {
        const documentSessionDate = toDateInputValue(document.sessionDate);
        if (documentSessionDate !== sessionDateFilter) {
          return false;
        }
      }

      return true;
    });
  }, [companyFilter, documentFilter, documents, sessionDateFilter, sessionFilter]);

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <h1 className="h3 fw-bold mb-0">Presupuestos · PO&apos;s</h1>
          <p className="text-muted mb-0">
            Documentos cuyo nombre empieza por <code>PO - DOC - </code>.
          </p>
        </div>
        {(documentsQuery.isLoading || documentsQuery.isFetching) && (
          <Spinner animation="border" role="status" size="sm" />
        )}
      </section>

      <div className="bg-white rounded-3 shadow-sm border p-3">
        <div className="row g-3">
          <div className="col-12 col-md-6 col-xl-3">
            <Form.Label htmlFor="pos-filter-documento" className="fw-semibold">
              Nombre del documento
            </Form.Label>
            <Form.Control
              id="pos-filter-documento"
              value={documentFilter}
              onChange={(event) => setDocumentFilter(event.target.value)}
              placeholder="Filtrar por nombre"
            />
          </div>
          <div className="col-12 col-md-6 col-xl-3">
            <Form.Label htmlFor="pos-filter-empresa" className="fw-semibold">
              Empresa
            </Form.Label>
            <Form.Control
              id="pos-filter-empresa"
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
              placeholder="Filtrar por empresa"
            />
          </div>
          <div className="col-12 col-md-6 col-xl-3">
            <Form.Label htmlFor="pos-filter-sesion" className="fw-semibold">
              Sesión
            </Form.Label>
            <Form.Control
              id="pos-filter-sesion"
              value={sessionFilter}
              onChange={(event) => setSessionFilter(event.target.value)}
              placeholder="Filtrar por sesión"
            />
          </div>
          <div className="col-12 col-md-6 col-xl-3">
            <Form.Label htmlFor="pos-filter-fecha" className="fw-semibold">
              Fecha de sesión
            </Form.Label>
            <Form.Control
              id="pos-filter-fecha"
              type="date"
              value={sessionDateFilter}
              onChange={(event) => setSessionDateFilter(event.target.value)}
            />
          </div>
        </div>
      </div>

      {documentsQuery.error ? (
        <Alert variant="danger" className="mb-0">
          No se pudieron cargar los documentos PO.
        </Alert>
      ) : null}

      <div className="bg-white rounded-3 shadow-sm border">
        <div className="table-responsive">
          <Table hover className="mb-0">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Nº presupuesto</th>
                <th>Origen</th>
                <th>Sesión</th>
                <th>Fecha de sesión</th>
                <th>Empresa</th>
              </tr>
            </thead>
            <tbody>
              {documentsQuery.isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-4">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-muted">
                    No hay documentos que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                filteredDocuments.map((document) => (
                  <tr key={document.id} className="align-middle">
                    <td>
                      {document.url ? (
                        <a href={document.url} target="_blank" rel="noreferrer">
                          {document.name}
                        </a>
                      ) : (
                        document.name
                      )}
                    </td>
                    <td>{document.dealId ?? '—'}</td>
                    <td>{document.kind === 'sesion' ? 'Sesión' : 'Presupuesto'}</td>
                    <td>{document.sessionName ?? '—'}</td>
                    <td>{formatDate(document.sessionDate)}</td>
                    <td>{document.companyName ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}

export default PosDocumentsPage;
