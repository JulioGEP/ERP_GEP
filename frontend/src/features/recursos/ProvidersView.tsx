// frontend/src/features/recursos/ProvidersView.tsx
import { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProviderModal, type ProviderFormValues } from './ProviderModal';
import { fetchProviders, updateProvider, type ProviderPayload } from './providers.api';
import type { Provider } from '../../types/provider';
import { ApiError } from '../../api/client';
import { useDataTable } from '../../hooks/useDataTable';
import { SortableHeader } from '../../components/table/SortableHeader';
import { DataTablePagination } from '../../components/table/DataTablePagination';

export type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type ProvidersViewProps = {
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

function buildPayload(values: ProviderFormValues): ProviderPayload {
  return {
    nombre_fiscal: values.nombre_fiscal,
    direccion_fiscal: values.direccion_fiscal || null,
    telefono_fiscal: values.telefono_fiscal || null,
    mail_empresa: values.mail_empresa || null,
    persona_contacto: values.persona_contacto || null,
    telefono_contacto: values.telefono_contacto || null,
    mail_contacto: values.mail_contacto || null,
  };
}

export function ProvidersView({ onNotify }: ProvidersViewProps) {
  const [showModal, setShowModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const queryClient = useQueryClient();

  const providersQuery = useQuery<Provider[], ApiError>({
    queryKey: ['providers'],
    queryFn: () => fetchProviders(),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ProviderPayload }) => updateProvider(id, payload),
    onSuccess: (provider) => {
      onNotify({ variant: 'success', message: `Proveedor "${provider.nombre_fiscal}" actualizado correctamente.` });
      setShowModal(false);
      setSelectedProvider(null);
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
    onError: (error: unknown) => {
      onNotify({ variant: 'danger', message: formatError(error) });
    },
  });

  const providers: Provider[] = providersQuery.data ?? [];
  const isLoading = providersQuery.isLoading;
  const isFetching = providersQuery.isFetching && !providersQuery.isLoading;
  const isSaving = updateMutation.isPending;
  const errorMessage = providersQuery.error ? formatError(providersQuery.error) : null;

  const getSortValue = useCallback((provider: Provider, column: string) => {
    switch (column) {
      case 'nombre_fiscal':
        return provider.nombre_fiscal;
      case 'persona_contacto':
        return provider.persona_contacto ?? '';
      case 'telefono_contacto':
        return provider.telefono_contacto ?? '';
      case 'mail_contacto':
        return provider.mail_contacto ?? '';
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
  } = useDataTable(providers, { getSortValue });

  const handleSelectProvider = (provider: Provider) => {
    setSelectedProvider(provider);
    setShowModal(true);
  };

  const handleModalClose = () => {
    if (isSaving) return;
    setShowModal(false);
  };

  const handleSubmit = (values: ProviderFormValues) => {
    if (!selectedProvider) return;
    const payload = buildPayload(values);
    updateMutation.mutate({ id: selectedProvider.provider_id, payload });
  };

  const subtitle = useMemo(
    () => 'Gestiona y actualiza los datos de contacto de tus proveedores.',
    []
  );

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Proveedores</h1>
          <p className="text-muted mb-0">{subtitle}</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {isFetching || isSaving ? <Spinner animation="border" role="status" size="sm" className="me-1" /> : null}
          <Button variant="outline-primary" onClick={() => providersQuery.refetch()} disabled={isFetching || isSaving}>
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
                  columnKey="nombre_fiscal"
                  label={<span className="fw-semibold">Nombre fiscal</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="persona_contacto"
                  label={<span className="fw-semibold">Persona de contacto</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="telefono_contacto"
                  label={<span className="fw-semibold">Teléfono de contacto</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="mail_contacto"
                  label={<span className="fw-semibold">Mail de contacto</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : totalItems ? (
                pageItems.map((provider) => (
                  <tr
                    key={provider.provider_id}
                    role="button"
                    onClick={() => handleSelectProvider(provider)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="fw-semibold">{provider.nombre_fiscal}</td>
                    <td>{provider.persona_contacto || '—'}</td>
                    <td>{provider.telefono_contacto || '—'}</td>
                    <td>{provider.mail_contacto || '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-5 text-center text-muted">
                    <div className="d-grid gap-3 justify-content-center">
                      <span>No hay proveedores registrados todavía.</span>
                      <div>
                        <Button variant="outline-primary" onClick={() => providersQuery.refetch()}>
                          Actualizar
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
        <DataTablePagination
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={totalItems}
          onPageChange={goToPage}
        />
      </div>

      <ProviderModal
        show={showModal}
        initialData={selectedProvider}
        isSaving={isSaving}
        onClose={handleModalClose}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
