// frontend/src/features/recursos/StockProductsView.tsx
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Alert, Badge, Button, Form, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product } from '../../types/product';
import type { Provider } from '../../types/provider';
import { fetchProducts, syncProducts, updateProduct } from './products.api';
import { fetchProviders } from './providers.api';
import { ApiError } from '../../api/client';

export type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

export type StockProductsViewProps = {
  onNotify: (toast: ToastParams) => void;
};

function formatErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }
  return 'Se ha producido un error inesperado.';
}

function buildSyncSummary(summary: Awaited<ReturnType<typeof syncProducts>>): string {
  if (!summary) return 'Sin resumen de sincronización disponible.';
  return `Productos importados: ${summary.imported}. Nuevos: ${summary.created}. Actualizados: ${summary.updated}. Desactivados: ${summary.deactivated}.`;
}

function mapProviderNames(providerIds: number[], providers: Provider[]): string[] {
  if (!providerIds.length) return [];
  const byId = new Map<number, string>(providers.map((provider) => [Number(provider.provider_id), provider.nombre_fiscal]));
  return providerIds
    .map((id) => byId.get(id))
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function normalizeCategory(category: Product['category']): string {
  return (category ?? '').trim().toLowerCase();
}

export function StockProductsView({ onNotify }: StockProductsViewProps) {
  const queryClient = useQueryClient();
  const [draftSelections, setDraftSelections] = useState<Record<string, number[]>>({});
  const [openProviderMenuId, setOpenProviderMenuId] = useState<string | null>(null);
  const providerDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const productsQuery = useQuery<Product[], ApiError>({
    queryKey: ['products'],
    queryFn: () => fetchProducts(),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const providersQuery = useQuery<Provider[], ApiError>({
    queryKey: ['providers'],
    queryFn: () => fetchProviders(),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, providerIds }: { id: string; providerIds: number[] }) =>
      updateProduct(id, { provider_ids: providerIds }),
    onSuccess: (product) => {
      onNotify({ variant: 'success', message: 'Proveedores actualizados correctamente.' });
      queryClient.setQueryData<Product[] | undefined>(['products'], (current) => {
        if (!current) return current;
        return current.map((item) => (item.id === product.id ? { ...product } : item));
      });
      setDraftSelections((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
    },
    onError: (error) => {
      onNotify({ variant: 'danger', message: formatErrorMessage(error) });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => syncProducts(),
    onSuccess: (summary) => {
      onNotify({ variant: 'success', message: buildSyncSummary(summary) });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error) => {
      onNotify({ variant: 'danger', message: formatErrorMessage(error) });
    },
  });

  const products = productsQuery.data ?? [];
  const providers = providersQuery.data ?? [];
  const isLoading = productsQuery.isLoading || providersQuery.isLoading;
  const isFetching = productsQuery.isFetching || providersQuery.isFetching;
  const isSaving = updateMutation.isPending || syncMutation.isPending;

  const productsError = productsQuery.error || providersQuery.error;
  const errorMessage = productsError ? formatErrorMessage(productsError) : null;

  const filteredProducts = useMemo(
    () => products.filter((product) => normalizeCategory(product.category) === 'productos'),
    [products],
  );

  const providerOptions = useMemo(() => {
    return providers
      .slice()
      .sort((a, b) => a.nombre_fiscal.localeCompare(b.nombre_fiscal, 'es', { sensitivity: 'base' }))
      .map((provider) => ({ value: Number(provider.provider_id), label: provider.nombre_fiscal }));
  }, [providers]);

  const handleProviderBlur = useCallback(
    (product: Product) => {
      const selection = draftSelections[product.id];
      if (!selection) return;
      updateMutation.mutate({ id: product.id, providerIds: selection });
    },
    [draftSelections, updateMutation],
  );

  const handleProviderToggle = (product: Product, providerId: number) => {
    const currentSelection = draftSelections[product.id] ?? product.provider_ids;
    const nextSelection = currentSelection.includes(providerId)
      ? currentSelection.filter((id) => id !== providerId)
      : [...currentSelection, providerId];

    setDraftSelections((prev) => ({ ...prev, [product.id]: nextSelection }));
  };

  const closeProviderMenu = useCallback(
    (productId?: string) => {
      const targetId = productId ?? openProviderMenuId;
      if (!targetId) return;

      const targetProduct = filteredProducts.find((item) => item.id === targetId);
      if (targetProduct) {
        handleProviderBlur(targetProduct);
      }
      setOpenProviderMenuId(null);
    },
    [filteredProducts, handleProviderBlur, openProviderMenuId],
  );

  useEffect(() => {
    if (!openProviderMenuId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const container = providerDropdownRefs.current[openProviderMenuId];
      if (container && !container.contains(event.target as Node)) {
        closeProviderMenu(openProviderMenuId);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeProviderMenu(openProviderMenuId);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeProviderMenu, openProviderMenuId]);

  const subtitle = useMemo(
    () => 'Consulta el stock de productos importados desde Pipedrive y asigna proveedores.',
    [],
  );

  const handleProviderInputKeyDown = (product: Product, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpenProviderMenuId(product.id);
    }

    if (event.key === 'Escape') {
      closeProviderMenu(product.id);
    }
  };

  const handleOpenProviderMenu = (product: Product) => {
    if (openProviderMenuId && openProviderMenuId !== product.id) {
      closeProviderMenu(openProviderMenuId);
    }
    setOpenProviderMenuId(product.id);
  };

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Stock</h1>
          <p className="text-muted mb-0">{subtitle}</p>
        </div>
        <div className="d-flex align-items-center gap-3 flex-wrap">
          {isFetching || isSaving ? <Spinner animation="border" role="status" size="sm" /> : null}
          <Button variant="primary" onClick={() => syncMutation.mutate()} disabled={isSaving}>
            Actualizar Stock
          </Button>
        </div>
      </section>

      {errorMessage ? (
        <Alert variant="danger" className="mb-0">
          {errorMessage}
        </Alert>
      ) : null}

      <div className="bg-white rounded-4 shadow-sm">
        <div className="table-responsive" style={{ maxHeight: '70vh' }}>
          <Table hover className="mb-0 align-middle">
            <thead className="text-muted text-uppercase small">
              <tr>
                <th scope="col" style={{ minWidth: 130 }}>
                  <span className="fw-semibold">Id de Pipedrive</span>
                </th>
                <th scope="col" style={{ minWidth: 220 }}>
                  <span className="fw-semibold">Nombre</span>
                </th>
                <th scope="col" style={{ minWidth: 140 }}>
                  <span className="fw-semibold">Código</span>
                </th>
                <th scope="col" style={{ minWidth: 140 }}>
                  <span className="fw-semibold">Categoría</span>
                </th>
                <th scope="col" style={{ minWidth: 260 }}>
                  <span className="fw-semibold">Proveedor</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-5 text-center text-muted">
                    No hay productos disponibles. Pulsa "Actualizar Stock" para sincronizar.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => {
                  const providerIds = draftSelections[product.id] ?? product.provider_ids;
                  const providerNames = mapProviderNames(providerIds, providers);

                  return (
                    <tr key={product.id}>
                      <td>{product.id_pipe || '—'}</td>
                      <td className="fw-semibold">{product.name || '—'}</td>
                      <td>{product.code || '—'}</td>
                      <td>{product.category || '—'}</td>
                      <td>
                        <div
                          className="d-grid gap-2 position-relative"
                          ref={(node) => {
                            providerDropdownRefs.current[product.id] = node;
                          }}
                        >
                          <Form.Control
                            type="text"
                            value={providerNames.join(', ')}
                            placeholder="Selecciona uno o varios proveedores"
                            readOnly
                            size="sm"
                            onClick={() => handleOpenProviderMenu(product)}
                            onFocus={() => handleOpenProviderMenu(product)}
                            onKeyDown={(event) => handleProviderInputKeyDown(product, event)}
                            disabled={updateMutation.isPending}
                            aria-haspopup="listbox"
                            aria-expanded={openProviderMenuId === product.id}
                            role="combobox"
                            aria-label={`Seleccionar proveedores para ${product.name ?? product.code ?? 'producto'}`}
                          />
                          {openProviderMenuId === product.id ? (
                            <div
                              className="dropdown-menu show w-100 p-3 shadow"
                              role="listbox"
                              aria-multiselectable="true"
                              style={{ maxHeight: 240, overflowY: 'auto' }}
                            >
                              {providerOptions.map((option, index) => {
                                const isSelected = providerIds.includes(option.value);
                                const optionId = `product-provider-${product.id}-${option.value}`;
                                return (
                                  <Form.Check
                                    key={option.value}
                                    id={optionId}
                                    type="checkbox"
                                    label={option.label}
                                    checked={isSelected}
                                    onChange={() => handleProviderToggle(product, option.value)}
                                    className={index !== providerOptions.length - 1 ? 'mb-2' : undefined}
                                    disabled={updateMutation.isPending}
                                    role="option"
                                    aria-selected={isSelected}
                                  />
                                );
                              })}
                              <div className="mt-3 d-flex gap-2 justify-content-end">
                                <Button
                                  variant="outline-secondary"
                                  size="sm"
                                  onClick={() => setOpenProviderMenuId(null)}
                                  disabled={updateMutation.isPending}
                                >
                                  Cancelar
                                </Button>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => closeProviderMenu(product.id)}
                                  disabled={updateMutation.isPending}
                                >
                                  Guardar selección
                                </Button>
                              </div>
                            </div>
                          ) : null}
                          <div className="d-flex flex-wrap gap-2">
                            {providerNames.length ? (
                              providerNames.map((name) => (
                                <Badge bg="primary" key={name} className="text-wrap">
                                  {name}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-muted small">Sin proveedor asignado</span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}
