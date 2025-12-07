import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product } from '../../types/product';
import {
  fetchProducts,
  syncProductsToHolded,
  type HoldedSyncResult,
  type SyncProductsToHoldedParams,
} from './products.api';
import { ApiError } from '../../api/client';

const PRODUCTS_HOLDED_QUERY_KEY = ['products', 'holded'];

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type ProductsHoldedViewProps = {
  onNotify: (toast: ToastParams) => void;
};

type SortKey = 'name' | 'id_pipe' | 'category' | 'price' | 'id_holded';

type SortConfig = {
  key: SortKey;
  direction: 'asc' | 'desc';
};

type HoldedSyncSummary = {
  total: number;
  success: number;
  skipped: number;
  errors: number;
  created: number;
  updated: number;
};

function formatPrice(product: Product): string {
  const value = product.price ?? null;
  if (value === null || value === undefined) return '';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value));
}

function summarizeResults(
  results: HoldedSyncResult[],
): { variant: ToastParams['variant']; message: string; stats: HoldedSyncSummary } {
  const success = results.filter((item) => item.status === 'success').length;
  const skipped = results.filter((item) => item.status === 'skipped').length;
  const errors = results.filter((item) => item.status === 'error').length;
  const created = results.filter((item) => item.status === 'success' && item.operation === 'created').length;
  const updated = results.filter((item) => item.status === 'success' && item.operation === 'updated').length;
  const total = results.length;

  const message =
    `Sincronización completada. Creados: ${created}. Actualizados: ${updated}. Total procesado: ${total}. ` +
    `Exitosos: ${success}. Omitidos: ${skipped}. Errores: ${errors}.`;
  const variant: ToastParams['variant'] = errors ? 'danger' : 'success';

  return { variant, message, stats: { success, skipped, errors, created, updated, total } };
}

export function ProductsHoldedView({ onNotify }: ProductsHoldedViewProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: PRODUCTS_HOLDED_QUERY_KEY,
    queryFn: fetchProducts,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastToggledIndex, setLastToggledIndex] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalSteps, setModalSteps] = useState<string[]>([]);
  const [modalErrors, setModalErrors] = useState<string[]>([]);
  const [syncResults, setSyncResults] = useState<HoldedSyncResult[]>([]);
  const [syncSummary, setSyncSummary] = useState<HoldedSyncSummary | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: 'asc' });

  useEffect(() => {
    if (data?.length) {
      setSelectedIds(new Set(data.map((product) => product.id)));
    } else {
      setSelectedIds(new Set());
    }
    setLastToggledIndex(null);
  }, [data]);

  const allSelected = useMemo(() => {
    if (!data?.length) return false;
    return selectedIds.size === data.length;
  }, [data, selectedIds]);

  const { mutate: syncHolded, isPending: isSyncing } = useMutation({
    mutationFn: (params: SyncProductsToHoldedParams) => syncProductsToHolded(params),
    onSuccess: (results) => {
      const summary = summarizeResults(results);
      onNotify({ variant: summary.variant, message: summary.message });
      setSyncSummary(summary.stats);
      setSyncResults(results);
      const errors = results
        .filter((item) => item.status === 'error')
        .map((item) => `Producto ${item.productId}: ${item.message ?? 'Error desconocido'}`);
      setModalErrors(errors);
      setModalSteps((prev) => prev.concat('Sincronización completada. Revisa el detalle a continuación.'));
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_HOLDED_QUERY_KEY });
    },
    onError: (mutationError) => {
      const message =
        mutationError instanceof ApiError
          ? mutationError.message
          : mutationError instanceof Error
          ? mutationError.message
          : 'Error desconocido al sincronizar con Holded';
      onNotify({ variant: 'danger', message });
      setModalErrors([message]);
      setModalSteps((prev) => prev.concat('La sincronización falló antes de completarse.'));
    },
  });

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else if (data?.length) {
      setSelectedIds(new Set(data.map((product) => product.id)));
    }
  };

  const toggleItem = (productId: string, index: number, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelect = !next.has(productId);

      if (shiftKey && lastToggledIndex !== null) {
        const [start, end] =
          index > lastToggledIndex ? [lastToggledIndex, index] : [index, lastToggledIndex];
        const range = sortedData.slice(start, end + 1);

        range.forEach((product) => {
          if (shouldSelect) {
            next.add(product.id);
          } else {
            next.delete(product.id);
          }
        });
      } else {
        if (next.has(productId)) {
          next.delete(productId);
        } else {
          next.add(productId);
        }
      }

      return next;
    });
    setLastToggledIndex(index);
  };

  const toggleSort = (key: SortKey) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }

      return { key, direction: 'asc' };
    });
  };

  const sortedData = useMemo(() => {
    if (!data) return [];

    const getValue = (product: Product, key: SortKey): string | number => {
      if (key === 'price') {
        return Number(product.price ?? 0);
      }

      const value = product[key];
      if (typeof value === 'number') return value;
      return value?.toString().toLowerCase() ?? '';
    };

    const sorted = [...data].sort((a, b) => {
      const valueA = getValue(a, sortConfig.key);
      const valueB = getValue(b, sortConfig.key);

      if (valueA < valueB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valueA > valueB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [data, sortConfig]);

  const startSync = () => {
    const steps = [
      '1. Se envían los IDs seleccionados al endpoint /products-holded.',
      '2. El endpoint ejecuta backend/functions/products-holded.ts para preparar los datos.',
      '3. Se crea/actualiza el producto en Holded y se guarda el id_holded en la base de datos.',
    ];
    setModalSteps(steps);
    setModalErrors([]);
    setSyncResults([]);
    setSyncSummary(null);
    setShowModal(true);
    syncHolded({
      productIds: Array.from(selectedIds),
      onBatchResult: (batchResults, batchIndex, totalBatches) => {
        setSyncResults((prev) => prev.concat(batchResults));
        setModalSteps((prev) =>
          prev.concat(
            `Lote ${batchIndex + 1} de ${totalBatches} procesado (${batchResults.length} resultados).`,
          ),
        );
        setModalErrors((prev) =>
          prev.concat(
            batchResults
              .filter((item) => item.status === 'error')
              .map((item) => `Producto ${item.productId}: ${item.message ?? 'Error desconocido'}`),
          ),
        );
      },
    });
  };

  if (isLoading) {
    return (
      <div className="d-flex align-items-center justify-content-center py-5">
        <Spinner animation="border" role="status" />
      </div>
    );
  }

  if (isError) {
    const message = error instanceof Error ? error.message : 'Error cargando productos';
    return <Alert variant="danger">{message}</Alert>;
  }

  const hasSelection = selectedIds.size > 0;

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex align-items-center gap-2">
        <Button variant="primary" disabled={!hasSelection || isSyncing} onClick={startSync}>
          {isSyncing ? 'Actualizando...' : 'Actualizar Holded'}
        </Button>
        {isFetching && <Spinner size="sm" animation="border" role="status" />}
      </div>

      <p className="text-muted small mb-0">
        Consejo: usa Shift + clic en las casillas de selección para marcar o desmarcar rangos completos.
      </p>

      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Actualización de Holded</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <div>
            <strong>Pasos del proceso:</strong>
            <ol className="mb-0">
              {modalSteps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </div>

          {modalErrors.length > 0 && (
            <div>
              <strong>Errores detectados:</strong>
              <ul className="mb-0">
                {modalErrors.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {syncSummary && (
            <div>
              <strong>Resumen de la ejecución:</strong>
              <p className="mb-0">
                Total procesado: {syncSummary.total}. Creados: {syncSummary.created}. Actualizados:{' '}
                {syncSummary.updated}. Exitosos: {syncSummary.success}. Omitidos: {syncSummary.skipped}. Errores: {' '}
                {syncSummary.errors}.
              </p>
            </div>
          )}

          {syncResults.length > 0 && (
            <div>
              <strong>Detalle de sincronización:</strong>
              <Table striped bordered hover size="sm" className="mb-0 mt-2">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Estado</th>
                    <th>Mensaje</th>
                  </tr>
                </thead>
                <tbody>
                  {syncResults.map((result) => (
                    <tr key={`${result.productId}-${result.status}`}>
                      <td>{result.productId}</td>
                      <td>{result.status}</td>
                      <td>{result.message ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>

      <div className="table-responsive">
        <Table striped hover size="sm">
          <thead>
            <tr>
              <th style={{ width: '3rem' }}>#</th>
              <th style={{ width: '3rem' }}>
                <Form.Check type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th role="button" onClick={() => toggleSort('name')}>
                Nombre {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th role="button" onClick={() => toggleSort('id_pipe')}>
                Id_Pipedrive {sortConfig.key === 'id_pipe' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th role="button" onClick={() => toggleSort('category')}>
                Categoría {sortConfig.key === 'category' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th role="button" onClick={() => toggleSort('price')}>
                Precio {sortConfig.key === 'price' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th role="button" onClick={() => toggleSort('id_holded')}>
                Id_Holded {sortConfig.key === 'id_holded' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((product, index) => (
              <tr key={product.id}>
                <td>{index + 1}</td>
                <td>
                  <Form.Check
                    type="checkbox"
                    checked={selectedIds.has(product.id)}
                    onChange={(event) => {
                      const nativeEvent = event.nativeEvent as KeyboardEvent | MouseEvent;
                      toggleItem(product.id, index, Boolean(nativeEvent.shiftKey));
                    }}
                  />
                </td>
                <td>{product.name ?? ''}</td>
                <td>{product.id_pipe}</td>
                <td>{product.category ?? ''}</td>
                <td>{formatPrice(product)}</td>
                <td>{product.id_holded ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
