// frontend/src/features/recursos/StockProductsView.tsx
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product, ProductAttribute } from '../../types/product';
import type { Provider } from '../../types/provider';
import { fetchProducts, syncProducts, updateProduct } from './products.api';
import { fetchProviders } from './providers.api';
import { ApiError } from '../../api/client';
import { FilterToolbar, type FilterDefinition } from '../../components/table/FilterToolbar';
import { splitFilterValue } from '../../components/table/filterUtils';
import { useTableFilterState } from '../../hooks/useTableFilterState';

export type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type AttributeEditorState = {
  productId: string;
  productName: string;
  atributos: ProductAttribute[];
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

function sumAttributeStock(atributos: ProductAttribute[]): number {
  return atributos.reduce((total, item) => total + (Number.isFinite(item.cantidad) ? item.cantidad : 0), 0);
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

type StockFilterRow = {
  product: Product;
  values: Record<string, string>;
  normalized: Record<string, string>;
  search: string;
  providerIds: Set<number>;
};

const STOCK_FILTER_KEYS = ['id_pipe', 'name', 'code', 'category', 'attributes', 'stock', 'providers'];

function createStockFilterRow(product: Product, providers: Provider[]): StockFilterRow {
  const providerNames = mapProviderNames(product.provider_ids, providers);
  const attributeStock = product.atributos.length ? sumAttributeStock(product.atributos) : null;
  const attributeText = product.atributos
    .map((atributo) => `${atributo.nombre} ${atributo.valor} ${atributo.cantidad}`)
    .join(' ');

  const providerIds = new Set<number>((product.provider_ids ?? []).map((id) => Number(id)));

  const values: Record<string, string> = {
    id_pipe: product.id_pipe ?? '',
    name: product.name ?? '',
    code: product.code ?? '',
    category: product.category ?? '',
    attributes: attributeText,
    stock: attributeStock != null ? String(attributeStock) : product.almacen_stock != null ? String(product.almacen_stock) : '',
    providers: providerNames.join(', '),
  };

  const normalized: Record<string, string> = {};
  STOCK_FILTER_KEYS.forEach((key) => {
    normalized[key] = normalizeText(values[key] ?? '');
  });

  const search = STOCK_FILTER_KEYS.map((key) => normalized[key]).join(' ');

  return {
    product,
    values,
    normalized,
    search,
    providerIds,
  };
}

function applyStockFilters(
  rows: StockFilterRow[],
  filters: Record<string, string>,
  search: string,
): StockFilterRow[] {
  const entries = Object.entries(filters).filter(([, value]) => value.trim().length);
  let filtered = rows;

  if (entries.length) {
    filtered = filtered.filter((row) =>
      entries.every(([key, value]) => {
        if (key === 'providers') {
          const selected = splitFilterValue(value)
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item));
          if (!selected.length) return true;
          return selected.some((providerId) => row.providerIds.has(providerId));
        }

        const target = row.normalized[key] ?? '';
        const parts = splitFilterValue(value);

        if (parts.length > 1) {
          return parts.some((part) => {
            const normalizedPart = normalizeText(part);
            if (!normalizedPart.length) return false;
            return target.includes(normalizedPart);
          });
        }

        const normalizedValue = normalizeText(value);
        if (!normalizedValue.length) return true;
        return target.includes(normalizedValue);
      }),
    );
  }

  const normalizedSearch = normalizeText(search);
  if (!normalizedSearch.length) {
    return filtered;
  }

  return filtered.filter((row) => row.search.includes(normalizedSearch));
}

export function StockProductsView({ onNotify }: StockProductsViewProps) {
  const queryClient = useQueryClient();
  const [draftSelections, setDraftSelections] = useState<Record<string, number[]>>({});
  const [draftStocks, setDraftStocks] = useState<Record<string, string>>({});
  const [openProviderMenuId, setOpenProviderMenuId] = useState<string | null>(null);
  const [attributeEditor, setAttributeEditor] = useState<AttributeEditorState | null>(null);
  const [attributeError, setAttributeError] = useState<string | null>(null);
  const providerDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const {
    filters: activeFilters,
    searchValue,
    setSearchValue,
    setFilterValue,
    clearFilter,
    clearAllFilters,
    setFiltersAndSearch,
  } = useTableFilterState({ tableKey: 'stock-products' });

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
    mutationFn: ({
      id,
      providerIds,
      almacenStock,
      atributos,
    }: {
      id: string;
      providerIds?: number[];
      almacenStock?: number | null;
      atributos?: ProductAttribute[] | null;
    }) =>
      updateProduct(id, { provider_ids: providerIds, almacen_stock: almacenStock, atributos }),
    onSuccess: (product) => {
      onNotify({ variant: 'success', message: 'Producto actualizado correctamente.' });
      queryClient.setQueryData<Product[] | undefined>(['products'], (current) => {
        if (!current) return current;
        return current.map((item) => (item.id === product.id ? { ...product } : item));
      });
      setDraftSelections((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      setDraftStocks((prev) => {
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

  const filteredProductsByCategory = useMemo(
    () => products.filter((product) => normalizeCategory(product.category) === 'productos'),
    [products],
  );

  const providerOptions = useMemo(() => {
    return providers
      .slice()
      .sort((a, b) => a.nombre_fiscal.localeCompare(b.nombre_fiscal, 'es', { sensitivity: 'base' }))
      .map((provider) => ({ value: String(provider.provider_id), label: provider.nombre_fiscal }));
  }, [providers]);

  const filterDefinitions = useMemo<FilterDefinition[]>(
    () => [
      { key: 'id_pipe', label: 'ID de Pipedrive' },
      { key: 'name', label: 'Nombre' },
      { key: 'code', label: 'Código' },
      { key: 'category', label: 'Categoría' },
      { key: 'attributes', label: 'Atributos' },
      { key: 'stock', label: 'Stock total', type: 'number' },
      { key: 'providers', label: 'Proveedor', type: 'select', options: providerOptions },
    ],
    [providerOptions],
  );

  const filterRows = useMemo(
    () => filteredProductsByCategory.map((product) => createStockFilterRow(product, providers)),
    [filteredProductsByCategory, providers],
  );

  const filteredRows = useMemo(
    () => applyStockFilters(filterRows, activeFilters, searchValue),
    [activeFilters, filterRows, searchValue],
  );

  const visibleProducts = useMemo(() => filteredRows.map((row) => row.product), [filteredRows]);

  const hasActiveFilters = useMemo(() => {
    if (searchValue.trim().length) return true;
    return Object.values(activeFilters).some((value) => value.trim().length);
  }, [activeFilters, searchValue]);

  const handleSearchChange = useCallback((value: string) => setSearchValue(value), [setSearchValue]);

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      setFilterValue(key, value);
    },
    [setFilterValue],
  );

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

      const targetProduct = visibleProducts.find((item) => item.id === targetId);
      if (targetProduct) {
        handleProviderBlur(targetProduct);
      }
      setOpenProviderMenuId(null);
    },
    [visibleProducts, handleProviderBlur, openProviderMenuId],
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

  const handleStockChange = (productId: string, value: string) => {
    setDraftStocks((prev) => ({ ...prev, [productId]: value }));
  };

  const handleStockBlur = (product: Product) => {
    if (product.atributos.length) return;
    if (!(product.id in draftStocks)) return;

    const value = draftStocks[product.id].trim();
    const parsed = value === '' ? null : Number(value);

    if (value !== '' && !Number.isFinite(parsed)) {
      onNotify({ variant: 'danger', message: 'Introduce un número válido para el stock de almacén.' });
      return;
    }

    updateMutation.mutate({ id: product.id, almacenStock: parsed });
  };

  const subtitle = useMemo(
    () => 'Consulta el stock de productos importados desde Pipedrive y asigna proveedores.',
    [],
  );

  const attributeEditorTotal = useMemo(
    () => (attributeEditor ? sumAttributeStock(attributeEditor.atributos) : 0),
    [attributeEditor],
  );

  const handleProviderInputKeyDown = (
    product: Product,
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
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

  const handleOpenAttributeEditor = (product: Product) => {
    setAttributeError(null);
    setAttributeEditor({
      productId: product.id,
      productName: product.name ?? product.code ?? 'Producto sin nombre',
      atributos: product.atributos.length
        ? product.atributos.map((item) => ({ ...item }))
        : [{ nombre: '', valor: '', cantidad: 0 }],
    });
  };

  const handleCloseAttributeEditor = () => {
    if (updateMutation.isPending) return;
    setAttributeEditor(null);
    setAttributeError(null);
  };

  const updateAttributeRow = (index: number, field: keyof ProductAttribute, value: string) => {
    setAttributeEditor((prev) => {
      if (!prev) return prev;
      const next = prev.atributos.slice();
      const current = next[index] ?? { nombre: '', valor: '', cantidad: 0 };

      if (field === 'cantidad') {
        const numericValue = value === '' ? 0 : Number(value);
        next[index] = {
          ...current,
          cantidad: Number.isFinite(numericValue) ? Math.max(0, Math.trunc(numericValue)) : 0,
        };
      } else {
        next[index] = { ...current, [field]: value } as ProductAttribute;
      }

      return { ...prev, atributos: next };
    });
  };

  const handleRemoveAttributeRow = (index: number) => {
    setAttributeEditor((prev) => {
      if (!prev) return prev;
      const next = prev.atributos.filter((_, position) => position !== index);
      return { ...prev, atributos: next.length ? next : [{ nombre: '', valor: '', cantidad: 0 }] };
    });
  };

  const handleAddAttributeRow = () => {
    setAttributeEditor((prev) => {
      if (!prev) return prev;
      return { ...prev, atributos: [...prev.atributos, { nombre: '', valor: '', cantidad: 0 }] };
    });
  };

  const handleSaveAttributes = () => {
    if (!attributeEditor) return;

    const normalized = attributeEditor.atributos
      .map((item) => ({
        nombre: item.nombre.trim(),
        valor: item.valor.trim(),
        cantidad: Number.isFinite(item.cantidad) ? Math.trunc(item.cantidad) : 0,
      }))
      .filter((item) => item.nombre || item.valor || item.cantidad);

    if (normalized.length === 0) {
      updateMutation.mutate(
        { id: attributeEditor.productId, atributos: [] },
        {
          onSuccess: () => {
            handleCloseAttributeEditor();
          },
        },
      );
      return;
    }

    const hasInvalidName = normalized.some((item) => !item.nombre || !item.valor);
    const hasInvalidQuantity = normalized.some((item) => !Number.isSafeInteger(item.cantidad) || item.cantidad < 0);

    if (hasInvalidName) {
      setAttributeError('Completa el nombre y el valor de cada atributo.');
      return;
    }

    if (hasInvalidQuantity) {
      setAttributeError('La cantidad debe ser un número entero mayor o igual que 0.');
      return;
    }

    updateMutation.mutate(
      { id: attributeEditor.productId, atributos: normalized },
      {
        onSuccess: () => {
          handleCloseAttributeEditor();
        },
      },
    );
  };

  return (
    <div className="d-grid gap-4">
      <section className="d-grid gap-3">
        <div className="d-flex flex-column flex-lg-row align-items-lg-start justify-content-between gap-3">
          <div className="d-flex flex-column gap-2 flex-grow-1">
            <div className="d-flex flex-wrap align-items-center gap-3">
              <h1 className="h3 fw-bold mb-0">Stock</h1>
              <div className="flex-grow-1" style={{ minWidth: 260 }}>
                <FilterToolbar
                  filters={filterDefinitions}
                  activeFilters={activeFilters}
                  searchValue={searchValue}
                  onSearchChange={handleSearchChange}
                  onFilterChange={handleFilterChange}
                  onRemoveFilter={clearFilter}
                  onClearAll={clearAllFilters}
                  resultCount={visibleProducts.length}
                  isServerBusy={isFetching}
                  viewStorageKey="stock-products-table"
                  onApplyFilterState={({ filters, searchValue }) => setFiltersAndSearch(filters, searchValue)}
                />
              </div>
            </div>
            <p className="text-muted mb-0">{subtitle}</p>
          </div>
          <div className="d-flex align-items-center gap-3 flex-wrap justify-content-lg-end">
            {isFetching || isSaving ? <Spinner animation="border" role="status" size="sm" /> : null}
            <Button variant="primary" onClick={() => syncMutation.mutate()} disabled={isSaving}>
              Actualizar Stock
            </Button>
          </div>
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
                <th scope="col" style={{ minWidth: 220 }}>
                  <span className="fw-semibold">Atributos</span>
                </th>
                <th scope="col" style={{ minWidth: 180 }}>
                  <span className="fw-semibold">Stock en almacén</span>
                </th>
                <th scope="col" style={{ minWidth: 260 }}>
                  <span className="fw-semibold">Proveedor</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : visibleProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-5 text-center text-muted">
                    {hasActiveFilters
                      ? 'No hay resultados para los filtros seleccionados.'
                      : 'No hay productos disponibles. Pulsa "Actualizar Stock" para sincronizar.'}
                  </td>
                </tr>
              ) : (
                visibleProducts.map((product) => {
                  const providerIds = draftSelections[product.id] ?? product.provider_ids;
                  const providerNames = mapProviderNames(providerIds, providers);
                  const atributos = product.atributos ?? [];
                  const hasAtributos = atributos.length > 0;
                  const attributeStock = hasAtributos ? sumAttributeStock(atributos) : null;
                  const stockValue = hasAtributos
                    ? String(attributeStock ?? product.almacen_stock ?? 0)
                    : draftStocks[product.id] ?? (product.almacen_stock ?? '').toString();

                  return (
                    <tr key={product.id}>
                      <td>{product.id_pipe || '—'}</td>
                      <td className="fw-semibold">{product.name || '—'}</td>
                      <td>{product.code || '—'}</td>
                      <td>{product.category || '—'}</td>
                      <td>
                        <div className="d-grid gap-2">
                          <Button
                            variant={hasAtributos ? 'outline-primary' : 'outline-secondary'}
                            size="sm"
                            onClick={() => handleOpenAttributeEditor(product)}
                            disabled={isSaving}
                          >
                            {hasAtributos ? 'Editar atributos' : 'Añadir atributos'}
                          </Button>
                          {hasAtributos ? (
                            <div className="d-grid gap-1">
                              {atributos.map((atributo, index) => (
                                <div
                                  key={`${atributo.nombre}-${atributo.valor}-${index}`}
                                  className="d-flex align-items-center justify-content-between gap-2"
                                >
                                  <span className="small text-muted text-wrap">{`${atributo.nombre} - ${atributo.valor}`}</span>
                                  <Badge bg="secondary" text="dark">
                                    {atributo.cantidad}
                                  </Badge>
                                </div>
                              ))}
                              <div className="d-flex justify-content-between align-items-center small fw-semibold">
                                <span>Total unidades</span>
                                <span>{attributeStock ?? 0}</span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted small">Sin atributos configurados</span>
                          )}
                        </div>
                      </td>
                      <td style={{ maxWidth: 180 }}>
                        <Form.Control
                          type="number"
                          value={stockValue}
                          size="sm"
                          onChange={(event) => handleStockChange(product.id, event.target.value)}
                          onBlur={() => handleStockBlur(product)}
                          readOnly={hasAtributos}
                          disabled={updateMutation.isPending || hasAtributos}
                          aria-label={`Stock en almacén para ${product.name ?? product.code ?? 'producto'}`}
                        />
                        {hasAtributos ? (
                          <div className="text-muted small mt-1">Stock calculado a partir de los atributos.</div>
                        ) : null}
                      </td>
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
                                const optionValue = Number(option.value);
                                const isSelected = providerIds.includes(optionValue);
                                const optionId = `product-provider-${product.id}-${option.value}`;
                                return (
                                  <Form.Check
                                    key={option.value}
                                    id={optionId}
                                    type="checkbox"
                                    label={option.label}
                                    checked={isSelected}
                                    onChange={() => handleProviderToggle(product, optionValue)}
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

      <Modal show={Boolean(attributeEditor)} onHide={handleCloseAttributeEditor} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Atributos de {attributeEditor?.productName}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-grid gap-3">
            <p className="mb-0 text-muted small">
              Define combinaciones de atributos con su cantidad. El stock total se calculará sumando todas las cantidades
              indicadas.
            </p>
            {attributeError ? (
              <Alert variant="danger" className="mb-0">
                {attributeError}
              </Alert>
            ) : null}
            {attributeEditor?.atributos.map((atributo, index) => (
              <div key={index} className="border rounded-3 p-3 d-grid gap-2">
                <div className="d-flex flex-column flex-lg-row gap-3">
                  <Form.Group className="flex-grow-1">
                    <Form.Label className="small mb-1">Nombre del atributo</Form.Label>
                    <Form.Control
                      value={atributo.nombre}
                      onChange={(event) => updateAttributeRow(index, 'nombre', event.target.value)}
                      placeholder="Ej.: Talla"
                      disabled={updateMutation.isPending}
                    />
                  </Form.Group>
                  <Form.Group className="flex-grow-1">
                    <Form.Label className="small mb-1">Valor</Form.Label>
                    <Form.Control
                      value={atributo.valor}
                      onChange={(event) => updateAttributeRow(index, 'valor', event.target.value)}
                      placeholder="Ej.: L"
                      disabled={updateMutation.isPending}
                    />
                  </Form.Group>
                  <Form.Group style={{ minWidth: 160 }}>
                    <Form.Label className="small mb-1">Cantidad</Form.Label>
                    <Form.Control
                      type="number"
                      min={0}
                      value={atributo.cantidad.toString()}
                      onChange={(event) => updateAttributeRow(index, 'cantidad', event.target.value)}
                      disabled={updateMutation.isPending}
                    />
                  </Form.Group>
                </div>
                <div className="d-flex justify-content-end">
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => handleRemoveAttributeRow(index)}
                    disabled={updateMutation.isPending}
                  >
                    Eliminar
                  </Button>
                </div>
              </div>
            ))}
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
              <Button variant="outline-primary" size="sm" onClick={handleAddAttributeRow} disabled={updateMutation.isPending}>
                Añadir atributo
              </Button>
              <div className="fw-semibold">Unidades totales: {attributeEditorTotal}</div>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={handleCloseAttributeEditor} disabled={updateMutation.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSaveAttributes} disabled={updateMutation.isPending}>
            Guardar
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
