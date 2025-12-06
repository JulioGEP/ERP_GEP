import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product } from '../../types/product';
import { fetchProducts, syncProductsToHolded, type HoldedSyncResult } from './products.api';
import { ApiError } from '../../api/client';

const PRODUCTS_HOLDED_QUERY_KEY = ['products', 'holded'];

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type ProductsHoldedViewProps = {
  onNotify: (toast: ToastParams) => void;
};

function formatPrice(product: Product): string {
  const value = product.id_price ?? product.price ?? null;
  if (value === null || value === undefined) return '';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value));
}

function summarizeResults(results: HoldedSyncResult[]): { variant: ToastParams['variant']; message: string } {
  const success = results.filter((item) => item.status === 'success').length;
  const skipped = results.filter((item) => item.status === 'skipped').length;
  const errors = results.filter((item) => item.status === 'error').length;

  const message = `Sincronización completada. Exitosos: ${success}. Omitidos: ${skipped}. Errores: ${errors}.`;
  const variant: ToastParams['variant'] = errors ? 'danger' : 'success';

  return { variant, message };
}

export function ProductsHoldedView({ onNotify }: ProductsHoldedViewProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: PRODUCTS_HOLDED_QUERY_KEY,
    queryFn: fetchProducts,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (data?.length) {
      setSelectedIds(new Set(data.map((product) => product.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [data]);

  const allSelected = useMemo(() => {
    if (!data?.length) return false;
    return selectedIds.size === data.length;
  }, [data, selectedIds]);

  const { mutate: syncHolded, isPending: isSyncing } = useMutation({
    mutationFn: syncProductsToHolded,
    onSuccess: (results) => {
      const summary = summarizeResults(results);
      onNotify(summary);
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
    },
  });

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else if (data?.length) {
      setSelectedIds(new Set(data.map((product) => product.id)));
    }
  };

  const toggleItem = (productId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
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
        <Button
          variant="primary"
          disabled={!hasSelection || isSyncing}
          onClick={() => syncHolded(Array.from(selectedIds))}
        >
          {isSyncing ? 'Actualizando...' : 'Actualizar Holded'}
        </Button>
        {isFetching && <Spinner size="sm" animation="border" role="status" />}
      </div>

      <div className="table-responsive">
        <Table striped hover size="sm">
          <thead>
            <tr>
              <th style={{ width: '3rem' }}>
                <Form.Check type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>Nombre</th>
              <th>Id_Pipedrive</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Id_Holded</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((product) => (
              <tr key={product.id}>
                <td>
                  <Form.Check
                    type="checkbox"
                    checked={selectedIds.has(product.id)}
                    onChange={() => toggleItem(product.id)}
                  />
                </td>
                <td>{product.name ?? ''}</td>
                <td>{product.id_pipe}</td>
                <td>{product.id_category ?? ''}</td>
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
