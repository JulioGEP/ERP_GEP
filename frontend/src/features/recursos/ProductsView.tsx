// frontend/src/features/recursos/ProductsView.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Alert, Badge, Button, Form, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product } from '../../types/product';
import {
  fetchProducts,
  syncProducts,
  updateProduct,
  type ProductSyncSummary,
  type ProductUpdatePayload,
} from './products.api';
import { ApiError } from '../presupuestos/api';
import '../certificados/lib/templates/training-templates';

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type ProductsViewProps = {
  onNotify: (toast: ToastParams) => void;
};

type TemplateOption = {
  value: string;
  label: string;
};

type UpdateVariables = {
  id: string;
  payload: ProductUpdatePayload;
  product: Product;
  field: 'template' | 'url_formacion' | 'active';
};

type TrainingTemplate = {
  id: string;
  name?: string;
  title?: string;
};

type TrainingTemplatesApi = {
  listTemplates: () => TrainingTemplate[];
  getTemplateById?: (id: string) => TrainingTemplate | null;
  subscribe?: (callback: () => void) => () => void;
};

declare global {
  interface Window {
    trainingTemplates?: TrainingTemplatesApi;
  }
}

function resolveErrorMessage(error: unknown): string {
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

function getTrainingTemplatesApi(): TrainingTemplatesApi | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.trainingTemplates ?? null;
}

function mapTemplateOptions(api: TrainingTemplatesApi | null): TemplateOption[] {
  if (!api) {
    return [];
  }

  const templates = api.listTemplates();
  const options = templates.map((template) => {
    const label = [template.name, template.title, template.id]
      .map((value) => (value ?? '').trim())
      .find((value) => value.length > 0);

    return {
      value: template.id,
      label: label ?? template.id,
    };
  });

  return options.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
}

function formatSyncSummary(summary: ProductSyncSummary | null): string {
  if (!summary) {
    return 'Sin resumen de sincronización disponible.';
  }

  const deactivated =
    typeof summary.deactivated === 'number'
      ? `${summary.deactivated}`
      : summary.deactivated;

  return `Productos importados: ${summary.imported}. Nuevos: ${summary.created}. Actualizados: ${summary.updated}. Desactivados: ${deactivated}.`;
}

export function ProductsView({ onNotify }: ProductsViewProps) {
  const queryClient = useQueryClient();
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([]);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const api = getTrainingTemplatesApi();
    const refreshOptions = () => {
      const currentApi = getTrainingTemplatesApi();
      setTemplateOptions(mapTemplateOptions(currentApi));
    };

    refreshOptions();

    if (api && typeof api.subscribe === 'function') {
      return api.subscribe(refreshOptions);
    }

    return undefined;
  }, []);

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  const syncMutation = useMutation<ProductSyncSummary | null>({
    mutationFn: () => syncProducts(),
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      onNotify({ variant: 'success', message: `Productos actualizados. ${formatSyncSummary(summary)}` });
    },
    onError: (error: unknown) => {
      onNotify({ variant: 'danger', message: resolveErrorMessage(error) });
    },
  });

  const updateMutation = useMutation<Product, unknown, UpdateVariables>({
    mutationFn: ({ id, payload }: UpdateVariables) => updateProduct(id, payload),
    onSuccess: (product, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      if (variables.field === 'url_formacion') {
        setUrlDrafts((current) => {
          const next = { ...current };
          delete next[variables.id];
          return next;
        });
      }

      if (variables.field === 'template') {
        setTemplateDrafts((current) => {
          const next = { ...current };
          delete next[variables.id];
          return next;
        });
      }

      const fieldLabel =
        variables.field === 'template'
          ? 'template'
          : variables.field === 'url_formacion'
          ? 'URL de formación'
          : 'estado';

      onNotify({
        variant: 'success',
        message: `Producto "${product.name ?? variables.product.name ?? variables.product.code ?? variables.id}" actualizado (${fieldLabel}).`,
      });
    },
    onError: (error: unknown, variables) => {
      onNotify({ variant: 'danger', message: resolveErrorMessage(error) });
      if (variables.field === 'url_formacion') {
        setUrlDrafts((current) => {
          const next = { ...current };
          delete next[variables.id];
          return next;
        });
      }

      if (variables.field === 'template') {
        setTemplateDrafts((current) => {
          const next = { ...current };
          delete next[variables.id];
          return next;
        });
      }
    },
  });

  const products = productsQuery.data ?? [];
  const isLoading = productsQuery.isLoading;
  const isFetching = productsQuery.isFetching && !productsQuery.isLoading;
  const errorMessage = productsQuery.error ? resolveErrorMessage(productsQuery.error) : null;
  const isSyncing = syncMutation.isPending;
  const isUpdating = updateMutation.isPending;

  const handleSync = useCallback(() => {
    if (isSyncing) return;
    syncMutation.mutate();
  }, [isSyncing, syncMutation]);

  const handleTemplateChange = useCallback(
    (product: Product, value: string) => {
      const normalized = value.trim();
      const currentValue = product.template ?? '';
      if (normalized === currentValue.trim()) {
        return;
      }

      setTemplateDrafts((current) => ({ ...current, [product.id]: normalized }));

      updateMutation.mutate({
        id: product.id,
        payload: { template: normalized.length ? normalized : null },
        product,
        field: 'template',
      });
    },
    [updateMutation]
  );

  const handleUrlChange = useCallback((productId: string, value: string) => {
    setUrlDrafts((current) => ({ ...current, [productId]: value }));
  }, []);

  const handleUrlCommit = useCallback(
    (product: Product) => {
      const draft = urlDrafts[product.id];
      const current = product.url_formacion ?? '';
      const normalized = (draft ?? current).trim();

      if ((normalized || '') === (current || '').trim()) {
        setUrlDrafts((currentDrafts) => {
          if (currentDrafts[product.id] === undefined) {
            return currentDrafts;
          }
          const next = { ...currentDrafts };
          delete next[product.id];
          return next;
        });
        return;
      }

      updateMutation.mutate({
        id: product.id,
        payload: { url_formacion: normalized.length ? normalized : null },
        product,
        field: 'url_formacion',
      });
    },
    [updateMutation, urlDrafts]
  );

  const handleUrlKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, product: Product) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
        handleUrlCommit(product);
      }
    },
    [handleUrlCommit]
  );

  const subtitle = useMemo(
    () => 'Consulta y actualiza los productos de Pipedrive vinculados a formaciones.',
    []
  );

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Productos</h1>
          <p className="text-muted mb-0">{subtitle}</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {(isFetching || isSyncing || isUpdating) && (
            <Spinner animation="border" role="status" size="sm" />
          )}
          <Button onClick={handleSync} disabled={isSyncing} variant="primary">
            Actualizar Productos
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
                <th className="fw-semibold">ID de Pipedrive</th>
                <th className="fw-semibold">Nombre</th>
                <th className="fw-semibold">Código</th>
                <th className="fw-semibold">Categoría</th>
                <th className="fw-semibold">Tipo</th>
                <th className="fw-semibold">Template</th>
                <th className="fw-semibold">URL formación</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-5 text-center text-muted">
                    No hay productos disponibles. Pulsa "Actualizar Productos" para sincronizar.
                  </td>
                </tr>
              ) : (
                products.map((product) => {
                  const urlValue = urlDrafts[product.id] ?? product.url_formacion ?? '';
                  const templateValue = templateDrafts[product.id] ?? product.template ?? '';
                  return (
                    <tr key={product.id}>
                      <td className="font-monospace">{product.id_pipe}</td>
                      <td>
                        <div className="d-flex flex-column gap-1">
                          <span className="fw-semibold">{product.name ?? '—'}</span>
                          <Badge bg={product.active ? 'success' : 'secondary'} className="align-self-start">
                            {product.active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </div>
                      </td>
                      <td>{product.code ?? '—'}</td>
                      <td>{product.category ?? '—'}</td>
                      <td>{product.type ?? '—'}</td>
                      <td style={{ minWidth: 200 }}>
                        <Form.Select
                          value={templateValue}
                          onChange={(event) => handleTemplateChange(product, event.target.value)}
                          disabled={isUpdating}
                        >
                          <option value="">Sin template</option>
                          {templateOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Form.Select>
                      </td>
                      <td style={{ minWidth: 240 }}>
                        <Form.Control
                          type="url"
                          placeholder="https://..."
                          value={urlValue}
                          onChange={(event) => handleUrlChange(product.id, event.target.value)}
                          onBlur={() => handleUrlCommit(product)}
                          onKeyDown={(event) => handleUrlKeyDown(event, product)}
                          disabled={isUpdating}
                        />
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
