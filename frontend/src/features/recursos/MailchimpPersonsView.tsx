import { useCallback, useMemo } from 'react';
import { Alert, Badge, Button, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import type { MailchimpPerson } from '../../types/mailchimpPerson';
import { DataTablePagination } from '../../components/table/DataTablePagination';
import { SortableHeader } from '../../components/table/SortableHeader';
import { useDataTable } from '../../hooks/useDataTable';
import {
  fetchMailchimpPersons,
  syncMailchimpPersons,
  type MailchimpPersonSyncSummary,
} from './mailchimpPersons.api';

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type MailchimpPersonsViewProps = {
  onNotify: (toast: ToastParams) => void;
};

function formatError(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Se ha producido un error inesperado';
}

function formatSyncSummary(summary: MailchimpPersonSyncSummary | null): string {
  if (!summary) {
    return 'Sin resumen de sincronización disponible.';
  }

  return `Personas importadas: ${summary.imported}. Nuevas: ${summary.created}. Actualizadas: ${summary.updated}.`;
}

function formatNumber(value: number | null, options?: Intl.NumberFormatOptions): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('es-ES', options);
}

function renderLabelIds(labelIds: string[]) {
  if (!labelIds.length) return '—';
  return (
    <div className="d-flex flex-wrap gap-1">
      {labelIds.map((label) => (
        <Badge bg="secondary" key={label} className="fw-semibold">
          {label}
        </Badge>
      ))}
    </div>
  );
}

export function MailchimpPersonsView({ onNotify }: MailchimpPersonsViewProps) {
  const queryClient = useQueryClient();

  const personsQuery = useQuery<MailchimpPerson[], ApiError>({
    queryKey: ['mailchimp-persons'],
    queryFn: () => fetchMailchimpPersons(),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const syncMutation = useMutation({
    mutationFn: () => syncMailchimpPersons(),
    onSuccess: (summary) => {
      onNotify({ variant: 'success', message: formatSyncSummary(summary) });
      queryClient.invalidateQueries({ queryKey: ['mailchimp-persons'] });
    },
    onError: (error: unknown) => {
      onNotify({ variant: 'danger', message: formatError(error) });
    },
  });

  const persons: MailchimpPerson[] = personsQuery.data ?? [];
  const isLoading = personsQuery.isLoading;
  const isFetching = personsQuery.isFetching && !personsQuery.isLoading;
  const isSyncing = syncMutation.isPending;
  const errorMessage = personsQuery.error ? formatError(personsQuery.error) : null;

  const getSortValue = useCallback((person: MailchimpPerson, column: string) => {
    switch (column) {
      case 'person_id':
        return person.person_id;
      case 'name':
        return person.name;
      case 'email':
        return person.email ?? '';
      case 'label_ids':
        return person.label_ids.join(', ');
      case 'org_name':
        return person.org_name ?? '';
      case 'org_address':
        return person.org_address ?? '';
      case 'size_employees':
        return person.size_employees ?? '';
      case 'segment':
        return person.segment ?? '';
      case 'employee_count':
        return person.employee_count ?? 0;
      case 'annual_revenue':
        return person.annual_revenue ?? 0;
      case 'formacion':
        return person.formacion ?? '';
      case 'servicio':
        return person.servicio ?? '';
      default:
        return null;
    }
  }, []);

  const {
    pageItems,
    sortState,
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    requestSort,
    goToPage,
  } = useDataTable(persons, { pageSize: 20, getSortValue });

  const subtitle = useMemo(
    () => 'Listado de personas en Pipedrive para sincronizar con Mailchimp.',
    [],
  );

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Mailchimp</h1>
          <p className="text-muted mb-0">{subtitle}</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {isFetching || isSyncing ? <Spinner animation="border" role="status" size="sm" className="me-1" /> : null}
          <Button variant="outline-primary" onClick={() => syncMutation.mutate()} disabled={isSyncing}>
            Actualizar
          </Button>
        </div>
      </section>

      {errorMessage && (
        <Alert variant="danger" className="mb-0">
          {errorMessage}
        </Alert>
      )}

      <div className="bg-white rounded-4 shadow-sm">
        <div className="table-responsive">
          <Table hover className="mb-0 align-middle">
            <thead>
              <tr className="text-muted text-uppercase small">
                <SortableHeader
                  columnKey="person_id"
                  label={<span className="fw-semibold">ID</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="name"
                  label={<span className="fw-semibold">Nombre</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="email"
                  label={<span className="fw-semibold">Correo</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="label_ids"
                  label={<span className="fw-semibold">Etiqueta</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="org_name"
                  label={<span className="fw-semibold">Organización</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="org_address"
                  label={<span className="fw-semibold">Dirección</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="size_employees"
                  label={<span className="fw-semibold">Tamaño empleados</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="segment"
                  label={<span className="fw-semibold">Segmento</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="employee_count"
                  label={<span className="fw-semibold">Empleados</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="annual_revenue"
                  label={<span className="fw-semibold">Ingresos</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="formacion"
                  label={<span className="fw-semibold">Formación</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="servicio"
                  label={<span className="fw-semibold">Servicio</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={12} className="text-center py-4 text-muted">
                    Cargando personas...
                  </td>
                </tr>
              ) : pageItems.length ? (
                pageItems.map((person) => (
                  <tr key={person.person_id}>
                    <td className="fw-semibold text-nowrap">{person.person_id}</td>
                    <td>{person.name}</td>
                    <td>{person.email ?? '—'}</td>
                    <td>{renderLabelIds(person.label_ids)}</td>
                    <td>{person.org_name ?? person.org_id ?? '—'}</td>
                    <td>{person.org_address ?? '—'}</td>
                    <td>{person.size_employees ?? '—'}</td>
                    <td>{person.segment ?? '—'}</td>
                    <td>{formatNumber(person.employee_count)}</td>
                    <td>{formatNumber(person.annual_revenue, { maximumFractionDigits: 2 })}</td>
                    <td>{person.formacion ?? '—'}</td>
                    <td>{person.servicio ?? '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={12} className="text-center py-4 text-muted">
                    No hay personas registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
        <DataTablePagination
          page={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          pageSize={pageSize}
          onPageChange={goToPage}
        />
      </div>
    </div>
  );
}
