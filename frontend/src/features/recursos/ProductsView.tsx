// frontend/src/features/recursos/ProductsView.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Alert, Badge, Button, Form, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Product } from '../../types/product';
import {
  fetchProducts,
  syncProducts,
  updateProduct,
  type ProductSyncSummary,
  type ProductUpdatePayload,
} from './products.api';
import { ApiError } from "../../api/client";
import {
  getTrainingTemplatesManager,
  type TrainingTemplate,
  type TrainingTemplatesManager,
} from '../certificados/lib/templates/training-templates';
import { FilterToolbar, type FilterDefinition, type FilterOption } from '../../components/table/FilterToolbar';
import { splitFilterValue } from '../../components/table/filterUtils';
import { useTableFilterState, type TableSortingState } from '../../hooks/useTableFilterState';

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
  field: 'template' | 'url_formacion' | 'active' | 'id_woo';
};

type TrainingTemplatesApi = TrainingTemplatesManager;

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
  return getTrainingTemplatesManager() ?? null;
}

async function mapTemplateOptions(api: TrainingTemplatesApi | null): Promise<TemplateOption[]> {
  if (!api) {
    return [];
  }

  const templates = await api.listTemplates();
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

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

type ProductFilterRow = {
  product: Product;
  values: Record<string, string>;
  normalized: Record<string, string>;
  search: string;
};

const PRODUCT_FILTER_DEFINITIONS: FilterDefinition[] = [
  { key: 'id_pipe', label: 'ID de Pipedrive' },
  { key: 'id_woo', label: 'Id Producto WC' },
  { key: 'name', label: 'Nombre' },
  { key: 'code', label: 'Código' },
  { key: 'category', label: 'Categoría' },
  { key: 'type', label: 'Tipo' },
  { key: 'template', label: 'Template' },
  { key: 'url_formacion', label: 'URL formación' },
  { key: 'estado', label: 'Estado' },
];

const PRODUCT_FILTER_ACCESSORS: Record<string, (product: Product) => string> = {
  id_pipe: (product) => String(product.id_pipe ?? '').trim(),
  id_woo: (product) => (product.id_woo != null ? String(product.id_woo) : ''),
  name: (product) => String(product.name ?? '').trim(),
  code: (product) => String(product.code ?? '').trim(),
  category: (product) => String(product.category ?? '').trim(),
  type: (product) => String(product.type ?? '').trim(),
  template: (product) => String(product.template ?? '').trim(),
  url_formacion: (product) => String(product.url_formacion ?? '').trim(),
  estado: (product) => (product.active ? 'activo' : 'inactivo'),
};

const PRODUCT_FILTER_KEYS = Object.keys(PRODUCT_FILTER_ACCESSORS);

const PRODUCT_SELECT_FILTER_KEYS = new Set<string>([
  'id_pipe',
  'id_woo',
  'name',
  'code',
  'category',
  'type',
  'template',
  'estado',
]);

function createProductFilterRow(product: Product): ProductFilterRow {
  const values: Record<string, string> = {};
  const normalized: Record<string, string> = {};
  for (const key of PRODUCT_FILTER_KEYS) {
    const raw = PRODUCT_FILTER_ACCESSORS[key]?.(product) ?? '';
    values[key] = raw;
    normalized[key] = normalizeText(raw);
  }
  const search = PRODUCT_FILTER_KEYS.map((key) => normalized[key]).join(' ');
  return { product, values, normalized, search };
}

function subsequenceScore(text: string, token: string): number {
  if (!token.length) return 0;
  let score = 0;
  let position = 0;
  for (const char of token) {
    const index = text.indexOf(char, position);
    if (index === -1) {
      return Number.POSITIVE_INFINITY;
    }
    score += index - position;
    position = index + 1;
  }
  return score;
}

function computeFuzzyScore(text: string, query: string): number {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (const token of tokens) {
    const score = subsequenceScore(text, token);
    if (!Number.isFinite(score)) {
      return Number.POSITIVE_INFINITY;
    }
    total += score;
  }
  return total;
}

function applyProductFilters(
  rows: ProductFilterRow[],
  filters: Record<string, string>,
  search: string,
): ProductFilterRow[] {
  const filterEntries = Object.entries(filters).filter(([, value]) => value.trim().length);
  let filtered = rows;
  if (filterEntries.length) {
    filtered = filtered.filter((row) =>
      filterEntries.every(([key, value]) => {
        const parts = splitFilterValue(value);
        if (parts.length > 1) {
          return parts.some((part) => {
            const normalizedPart = normalizeText(part);
            if (!normalizedPart.length) return false;
            const targetValue = row.normalized[key] ?? '';
            return targetValue.includes(normalizedPart);
          });
        }
        const normalizedValue = normalizeText(value);
        if (!normalizedValue.length) return true;
        const target = row.normalized[key] ?? '';
        return target.includes(normalizedValue);
      }),
    );
  }

  const normalizedSearch = normalizeText(search);
  if (!normalizedSearch.length) {
    return filtered;
  }

  const scored = filtered
    .map((row) => ({ row, score: computeFuzzyScore(row.search, normalizedSearch) }))
    .filter((item) => Number.isFinite(item.score));

  scored.sort((a, b) => a.score - b.score);
  return scored.map((item) => item.row);
}

export function ProductsView({ onNotify }: ProductsViewProps) {
  const queryClient = useQueryClient();
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([]);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, string>>({});
  const [idWooDrafts, setIdWooDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const api = getTrainingTemplatesApi();
    let cancelled = false;

    const refreshOptions = async () => {
      const currentApi = getTrainingTemplatesApi();
      try {
        const options = await mapTemplateOptions(currentApi);
        if (!cancelled) {
          setTemplateOptions(options);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('No se pudieron cargar las plantillas disponibles', error);
          setTemplateOptions([]);
        }
      }
    };

    void refreshOptions();

    let unsubscribe: (() => void) | undefined;
    if (api && typeof api.subscribe === 'function') {
      try {
        unsubscribe = api.subscribe(() => {
          void refreshOptions();
        });
      } catch (error) {
        console.warn('No se pudo suscribir a los cambios de plantillas', error);
      }
    }

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
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

      if (variables.field === 'id_woo') {
        setIdWooDrafts((current) => {
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
          : variables.field === 'id_woo'
          ? 'Id Producto WC'
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

      if (variables.field === 'id_woo') {
        setIdWooDrafts((current) => {
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

  const handleIdWooChange = useCallback((productId: string, value: string) => {
    setIdWooDrafts((current) => ({ ...current, [productId]: value }));
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

  const handleIdWooCommit = useCallback(
    (product: Product) => {
      const draft = idWooDrafts[product.id];
      const currentValue = product.id_woo;
      const normalizedDraft = (draft ?? '').trim();
      const normalized = normalizedDraft.length ? Number(normalizedDraft) : null;

      if (normalizedDraft.length && !Number.isFinite(normalized ?? NaN)) {
        setIdWooDrafts((currentDrafts) => {
          const next = { ...currentDrafts };
          delete next[product.id];
          return next;
        });
        onNotify({ variant: 'danger', message: 'El Id Producto WC debe ser un número válido.' });
        return;
      }

      if (normalized === currentValue || (normalized === null && currentValue == null)) {
        setIdWooDrafts((currentDrafts) => {
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
        payload: { id_woo: normalized },
        product,
        field: 'id_woo',
      });
    },
    [idWooDrafts, onNotify, updateMutation]
  );

  const handleIdWooKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, product: Product) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
        handleIdWooCommit(product);
      }
    },
    [handleIdWooCommit]
  );

  const handleUrlKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, product: Product) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
        handleUrlCommit(product);
      }
    },
    [handleUrlCommit]
  );

  const {
    filters: activeFilters,
    searchValue,
    sorting: sortingFromUrl,
    setSearchValue,
    setFilterValue,
    clearFilter,
    clearAllFilters,
    setSorting: setSortingInUrl,
  } = useTableFilterState({ tableKey: 'products-table' });

  const [sortingState, setSortingState] = useState<TableSortingState>(sortingFromUrl);

  useEffect(() => {
    setSortingState(sortingFromUrl);
  }, [sortingFromUrl]);

  const handleSortingChange = useCallback(
    (next: SortingState) => {
      const normalized = next.map((item) => ({ id: item.id, desc: Boolean(item.desc) }));
      setSortingState(normalized);
      setSortingInUrl(normalized);
    },
    [setSortingInUrl],
  );

  const preparedRows = useMemo(
    () => products.map((product) => createProductFilterRow(product)),
    [products],
  );

  const selectOptionsByKey = useMemo(() => {
    const accumulator = new Map<string, Set<string>>();
    PRODUCT_SELECT_FILTER_KEYS.forEach((key) => {
      accumulator.set(key, new Set<string>());
    });

    preparedRows.forEach((row) => {
      PRODUCT_SELECT_FILTER_KEYS.forEach((key) => {
        const raw = row.values[key] ?? '';
        const trimmed = raw.trim();
        if (!trimmed.length) return;
        const set = accumulator.get(key);
        set?.add(trimmed);
      });
    });

    const result: Record<string, FilterOption[]> = {};
    PRODUCT_SELECT_FILTER_KEYS.forEach((key) => {
      const values = accumulator.get(key);
      if (!values || !values.size) {
        result[key] = [];
        return;
      }
      const sorted = Array.from(values).sort((a, b) =>
        a.localeCompare(b, 'es', { sensitivity: 'base' }),
      );
      result[key] = sorted.map((value) => ({ value, label: value }));
    });

    return result;
  }, [preparedRows]);

  const filterDefinitions = useMemo<FilterDefinition[]>(
    () =>
      PRODUCT_FILTER_DEFINITIONS.map((definition) => {
        if (!PRODUCT_SELECT_FILTER_KEYS.has(definition.key)) {
          return definition;
        }

        const options = selectOptionsByKey[definition.key] ?? [];
        return {
          ...definition,
          type: 'select',
          options,
          placeholder: definition.placeholder ?? 'Selecciona una opción',
        } satisfies FilterDefinition;
      }),
    [selectOptionsByKey],
  );

  const filteredRows = useMemo(
    () => applyProductFilters(preparedRows, activeFilters, searchValue),
    [preparedRows, activeFilters, searchValue],
  );

  const filteredProducts = useMemo(
    () => filteredRows.map((row) => row.product),
    [filteredRows],
  );

  const tanstackSortingState = useMemo<SortingState>(
    () => sortingState.map((item) => ({ id: item.id, desc: item.desc })),
    [sortingState],
  );

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      const trimmed = value.trim();
      setFilterValue(key, trimmed.length ? trimmed : null);
    },
    [setFilterValue],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
    },
    [setSearchValue],
  );

  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  const columns = useMemo<ColumnDef<Product>[]>(() => {
    const baseColumns: ColumnDef<Product>[] = [
      {
        id: 'id_pipe',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              ID de Pipedrive
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (product) => String(product.id_pipe ?? '').trim(),
        cell: ({ row }) => <span className="font-monospace">{row.original.id_pipe ?? '—'}</span>,
        meta: { style: { minWidth: 140 } },
      },
      {
        id: 'id_woo',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Id Producto WC
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (product) => (product.id_woo != null ? Number(product.id_woo) : Number.POSITIVE_INFINITY),
        cell: ({ row }) => {
          const product = row.original;
          const idWooValue = idWooDrafts[product.id] ?? (product.id_woo?.toString() ?? '');
          return (
            <Form.Control
              type="number"
              placeholder="—"
              value={idWooValue}
              onChange={(event) => handleIdWooChange(product.id, event.target.value)}
              onBlur={() => handleIdWooCommit(product)}
              onKeyDown={(event) => handleIdWooKeyDown(event, product)}
              disabled={isUpdating}
              min={0}
              step={1}
            />
          );
        },
        enableSorting: true,
        meta: { style: { minWidth: 160 } },
      },
      {
        id: 'name',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Nombre
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (product) => String(product.name ?? '').trim(),
        cell: ({ row }) => {
          const product = row.original;
          return (
            <div className="d-flex flex-column gap-1">
              <span className="fw-semibold">{product.name ?? '—'}</span>
              <Badge bg={product.active ? 'success' : 'secondary'} className="align-self-start">
                {product.active ? 'Activo' : 'Inactivo'}
              </Badge>
            </div>
          );
        },
        meta: { style: { minWidth: 200 } },
      },
      {
        id: 'code',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Código
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (product) => String(product.code ?? '').trim(),
        cell: ({ row }) => row.original.code ?? '—',
      },
      {
        id: 'category',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Categoría
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (product) => String(product.category ?? '').trim(),
        cell: ({ row }) => row.original.category ?? '—',
      },
      {
        id: 'type',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Tipo
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (product) => String(product.type ?? '').trim(),
        cell: ({ row }) => row.original.type ?? '—',
      },
      {
        id: 'template',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Template
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (product) => String(product.template ?? '').trim(),
        cell: ({ row }) => {
          const product = row.original;
          const templateValue = templateDrafts[product.id] ?? product.template ?? '';
          return (
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
          );
        },
        meta: { style: { minWidth: 200 } },
      },
      {
        id: 'url_formacion',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              URL formación
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (product) => String(product.url_formacion ?? '').trim(),
        cell: ({ row }) => {
          const product = row.original;
          const urlValue = urlDrafts[product.id] ?? product.url_formacion ?? '';
          return (
            <Form.Control
              type="url"
              placeholder="https://..."
              value={urlValue}
              onChange={(event) => handleUrlChange(product.id, event.target.value)}
              onBlur={() => handleUrlCommit(product)}
              onKeyDown={(event) => handleUrlKeyDown(event, product)}
              disabled={isUpdating}
            />
          );
        },
        meta: { style: { minWidth: 240 } },
      },
    ];

    return baseColumns;
  }, [
    handleIdWooChange,
    handleIdWooCommit,
    handleIdWooKeyDown,
    handleTemplateChange,
    handleUrlChange,
    handleUrlCommit,
    handleUrlKeyDown,
    idWooDrafts,
    isUpdating,
    templateDrafts,
    templateOptions,
    urlDrafts,
  ]);

  const table = useReactTable({
    data: filteredProducts,
    columns,
    state: { sorting: tanstackSortingState },
    onSortingChange: handleSortingChange,
    getRowId: (row) => row.id,
  });

  const rowModel = table.getRowModel();
  const rows = rowModel.rows;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  const columnsCount = table.getAllColumns().length;
  const resultCount = filteredProducts.length;
  const noFilteredResults = !filteredProducts.length && products.length > 0;

  const subtitle = useMemo(
    () => 'Consulta y actualiza los productos de Pipedrive vinculados a formaciones.',
    []
  );

  return (
    <div className="d-grid gap-4">
      <section className="d-grid gap-3">
        <div className="d-flex flex-column flex-lg-row align-items-lg-start justify-content-between gap-3">
          <div className="d-flex flex-column gap-2 flex-grow-1">
            <div className="d-flex flex-wrap align-items-center gap-3">
              <h1 className="h3 fw-bold mb-0">Productos</h1>
              <div className="flex-grow-1" style={{ minWidth: '240px' }}>
                <FilterToolbar
                  filters={filterDefinitions}
                  activeFilters={activeFilters}
                  searchValue={searchValue}
                  onSearchChange={handleSearchChange}
                  onFilterChange={handleFilterChange}
                  onRemoveFilter={clearFilter}
                  onClearAll={clearAllFilters}
                  resultCount={resultCount}
                  isServerBusy={isFetching}
                  viewStorageKey="products-table"
                />
              </div>
            </div>
            <p className="text-muted mb-0">{subtitle}</p>
          </div>
          <div className="d-flex align-items-center gap-3 flex-wrap justify-content-lg-end">
            {(isFetching || isSyncing || isUpdating) && (
              <Spinner animation="border" role="status" size="sm" />
            )}
            <Button onClick={handleSync} disabled={isSyncing} variant="primary">
              Actualizar Productos
            </Button>
          </div>
        </div>
      </section>

      {errorMessage && (
        <Alert variant="danger" className="mb-0">
          {errorMessage}
        </Alert>
      )}

      <div className="bg-white rounded-4 shadow-sm">
        <div
          className="table-responsive"
          style={{ maxHeight: '70vh' }}
          ref={tableContainerRef}
        >
          <Table hover className="mb-0 align-middle">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta as { style?: CSSProperties } | undefined;
                    const style = meta?.style;
                    return (
                      <th key={header.id} style={style} scope="col">
                        {header.isPlaceholder ? null : header.renderHeader()}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={columnsCount} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={columnsCount} className="py-5 text-center text-muted">
                    No hay productos disponibles. Pulsa "Actualizar Productos" para sincronizar.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columnsCount} className="py-5 text-center text-muted">
                    {noFilteredResults
                      ? 'No hay productos que coincidan con los filtros aplicados.'
                      : 'No hay productos disponibles.'}
                  </td>
                </tr>
              ) : (
                <>
                  {paddingTop > 0 && (
                    <tr>
                      <td colSpan={columnsCount} style={{ height: `${paddingTop}px` }} />
                    </tr>
                  )}
                  {virtualRows.map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    return (
                      <tr key={row.id}>
                        {row.getVisibleCells().map((cell) => {
                          const meta = cell.column.columnDef.meta as { style?: CSSProperties } | undefined;
                          const style = meta?.style;
                          return (
                            <td key={cell.id} style={style}>
                              {cell.renderValue()}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr>
                      <td colSpan={columnsCount} style={{ height: `${paddingBottom}px` }} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}
